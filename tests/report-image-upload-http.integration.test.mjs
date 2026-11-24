import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { IMAGE_SOURCE_MAX_BYTES } from "../lib/api-zod/src/image-policy.ts";

function padJpegWithComments(jpeg, targetBytes) {
  assert.deepEqual([...jpeg.subarray(-2)], [0xff, 0xd9]);
  const pieces = [jpeg.subarray(0, -2)];
  let size = jpeg.length;
  while (size + 4 <= targetBytes) {
    const dataBytes = Math.min(65_533, targetBytes - size - 4);
    const segment = Buffer.alloc(dataBytes + 4, 0x41);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    segment.writeUInt16BE(dataBytes + 2, 2);
    pieces.push(segment);
    size += segment.length;
  }
  pieces.push(jpeg.subarray(-2));
  return Buffer.concat(pieces);
}

test("the real report upload entry confirms isolated objects and preserves authorization", async t => {
  process.env.NODE_ENV = "development";
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  const bucketId = process.env.IMAGE_AUDIT_BUCKET_ID;
  assert.ok(bucketId && bucketId !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID, "Independent test bucket required");
  const pg = await isolatedPostgres();
  let pool, server, temporaryRoot, cloudBucket, originalWorkingDirectory, companiesRouter;
  const written = new Set();
  try {
    const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
    const express = require("express"), sharp = require("sharp");
    const { objectStorageClient } = await import("../artifacts/api-server/src/lib/objectStorage.ts");
    const bucket = objectStorageClient.bucket.bind(objectStorageClient);
    objectStorageClient.bucket = (id, ...args) => {
      if (id !== bucketId) throw new Error("Nonisolated storage refused");
      const result = bucket(id, ...args), file = result.file.bind(result);
      result.file = (name, ...args) => {
        const object = file(name, ...args), stream = object.createWriteStream.bind(object);
        object.createWriteStream = (...args) => { written.add(name); return stream(...args); };
        return object;
      };
      return result;
    };
    cloudBucket = bucket(bucketId);
    const schema = await import("../lib/db/src/index.ts");
    const {
      db, usersTable, projectsTable, projectFilesTable, imageAssetsTable, projectMembersTable,
      reportsTable, companiesTable, attendanceRecordsTable,
    } = schema;
    pool = schema.pool;
    const [admin, viewer, engineer] = await db.insert(usersTable).values([
      { phone: "synthetic-image-http-admin", fullName: "Synthetic", passwordHash: "unused", role: "admin" },
      { phone: "synthetic-image-http-viewer", fullName: "Synthetic", passwordHash: "unused", role: "viewer" },
      { phone: "synthetic-image-http-engineer", fullName: "Synthetic", passwordHash: "unused", role: "engineer" },
    ]).returning();
    const [project] = await db.insert(projectsTable).values({
      name: "Synthetic image HTTP", location: "Synthetic", ownerEntity: "Synthetic", supervisorEntity: "Synthetic", contractor: "Synthetic",
    }).returning();
    await db.insert(projectMembersTable).values({
      projectId: project.id, userId: engineer.id, role: "engineer", tabPermissions: { files: "hidden", reports: "edit" },
    });
    const { signToken } = await import("../artifacts/api-server/src/lib/auth.ts");
    const token = user => signToken({ userId: user.id, role: user.role, phone: user.phone });
    const { createReportImageUploadsRouter } = await import("../artifacts/api-server/src/routes/report-image-uploads.ts");
    const { createFileImageUploadsRouter } = await import("../artifacts/api-server/src/routes/file-image-uploads.ts");
    const { resolveStoredImageForRead } = await import("../artifacts/api-server/src/lib/image-read-reference.ts");
    const { streamStoredImage } = await import("../artifacts/api-server/src/lib/image-object-stream.ts");
    const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#527083" } }).jpeg().toBuffer();
    temporaryRoot = await mkdtemp(path.resolve("generated-artifacts/image-http-"));
    originalWorkingDirectory = process.cwd();
    await mkdir(path.join(temporaryRoot, "uploads"), { recursive: true });
    await mkdir(path.join(temporaryRoot, "src/fonts"), { recursive: true });
    await symlink(path.join(originalWorkingDirectory, "artifacts/api-server/src/fonts/Amiri-Regular.ttf"),
      path.join(temporaryRoot, "src/fonts/Amiri-Regular.ttf"));
    const legacyFilename = `legacy-${randomUUID()}.jpg`;
    const legacyBytes = await sharp(source).jpeg({ quality: 83 }).toBuffer();
    await writeFile(path.join(temporaryRoot, "uploads", legacyFilename), legacyBytes, { flag: "wx" });
    await db.insert(projectFilesTable).values({
      projectId: project.id, filename: legacyFilename, originalName: "Synthetic legacy",
      category: "image", fileUrl: `/api/uploads/${legacyFilename}`,
      fileSize: legacyBytes.length, mimeType: "image/jpeg",
    });
    process.chdir(temporaryRoot);
    companiesRouter = (await import("../artifacts/api-server/src/routes/companies.ts")).default;
    const actualApp = (await import("../artifacts/api-server/src/app.ts")).default;
    process.chdir(originalWorkingDirectory);
    const app = express();
    // Deliberately no parser before the real router.
    app.use("/api", createReportImageUploadsRouter({ temporaryRoot }));
    app.use("/api", createFileImageUploadsRouter({ temporaryRoot }));
    app.use("/api", companiesRouter);
    app.get("/api/uploads/:filename", actualApp);
    app.get("/api/projects/:projectId/reports/export-pdf", actualApp);
    app.use(actualApp);
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/reports/uploads`;
    const packet = { mode: "prepared", clientKey: randomUUID(), fileName: "synthetic.jpg", encoding: "webp", base64: source.toString("base64") };
    const post = (body, user = admin) => fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${token(user)}`, "Content-Type": "text/plain" },
      body: typeof body === "string" ? body : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    let uploaded;
    await t.test("prepared transport commits one file and its three durable references", async () => {
      const response = await post(packet);
      assert.equal(response.status, 201);
      uploaded = await response.json();
      assert.equal(uploaded.image.state, "ready");
      assert.equal(uploaded.projectId, project.id);
      assert.equal(uploaded.fileSize, uploaded.image.byteSize);
      assert.equal(uploaded.image.width, 1200);
      assert.equal(written.size, 3);
      assert.ok(!JSON.stringify(uploaded).includes(packet.base64));
      const read = await resolveStoredImageForRead(uploaded.filename, "thumbnail", project.id);
      assert.equal(read.kind, "ready");
      assert.ok(read.bucketId === bucketId);
      const remote = await streamStoredImage(read.filename, read.bucketId);
      const chunks = []; for await (const chunk of remote.stream) chunks.push(chunk);
      const metadata = await sharp(Buffer.concat(chunks)).metadata();
      assert.ok(metadata.width <= 400);
      assert.equal((await resolveStoredImageForRead(uploaded.filename, "primary", project.id + 1)).kind, "missing");
    });
    await t.test("lost-response retries return the same identity without another write", async () => {
      const api = await import("../lib/api-client-react/src/index.ts");
      api.setBaseUrl(new URL(url).origin);
      let retried;
      try {
        retried = await api.uploadReportImage(project.id, packet, {
          headers: { Authorization: `Bearer ${token(admin)}`, "Content-Type": "text/plain" },
        });
      } finally { api.setBaseUrl(null); }
      assert.equal(retried.id, uploaded.id); assert.equal(retried.image.id, uploaded.image.id);
      assert.equal(written.size, 3);
      assert.equal((await db.select().from(projectFilesTable)).length, 2);
      assert.equal((await db.select().from(imageAssetsTable)).length, 1);
      const status = await fetch(`${url}/status?clientKey=${packet.clientKey}`, {
        headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(status.status, 200);
      const state = await status.json();
      assert.equal(state.state, "ready"); assert.equal(state.file.id, uploaded.id);
      assert.equal(written.size, 3);
    });
    await t.test("authorization rejects an unassigned viewer before malformed body parsing", async () => {
      const response = await post("{", viewer);
      assert.equal(response.status, 403); assert.ok(response.headers.get("content-type").includes("application/json"));
      assert.equal(written.size, 3);
    });
    await t.test("corrupt content and invalid envelopes never publish a file", async () => {
      const malformed = await post("{"); assert.equal(malformed.status, 415);
      const corrupt = await post({ ...packet, clientKey: randomUUID(), base64: Buffer.from("not an image").toString("base64") });
      assert.equal(corrupt.status, 415);
      assert.equal((await db.select().from(projectFilesTable)).length, 2);
      assert.equal(written.size, 3);
    });
    await t.test("multipart compatibility uses the same durable JPEG pipeline", async () => {
      const form = new FormData(); form.set("file", new Blob([source], { type: "image/jpeg" }), "synthetic-legacy.jpg");
      const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token(admin)}` }, body: form, signal: AbortSignal.timeout(20_000) });
      assert.equal(response.status, 201);
      const row = await response.json(); assert.equal(row.mimeType, "image/jpeg"); assert.equal(row.image.printKey, row.image.storageKey);
      assert.equal((await db.select().from(projectFilesTable)).length, 3);
      for (let attempt = 0; attempt < 50 && (await readdir(temporaryRoot)).length; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual((await readdir(temporaryRoot)).filter(name => !["uploads", "src"].includes(name)), []);
    });
    await t.test("Reports edit without Files access can upload and view only authorized report photos", async () => {
      const response = await post({ ...packet, clientKey: randomUUID() }, engineer);
      assert.equal(response.status, 201);
      const row = await response.json(), base = new URL(url).origin;
      const photo = await fetch(`${base}${row.fileUrl}?variant=report-thumbnail`, { headers: { Authorization: `Bearer ${token(engineer)}` } });
      assert.equal(photo.status, 200);
      assert.ok(photo.headers.get("cache-control").includes("private"));
      assert.ok(photo.headers.get("cache-control").includes("no-store"));
      assert.ok((await photo.arrayBuffer()).byteLength > 0);
      // Another member's unattached upload does not become a general files grant.
      const other = await fetch(`${base}${uploaded.fileUrl}`, { headers: { Authorization: `Bearer ${token(engineer)}` } });
      assert.ok([401, 403, 404].includes(other.status));
      await db.insert(reportsTable).values({
        projectId: project.id, type: "weekly", reportDate: "2026-11-24", periodStart: "2026-11-18", periodEnd: "2026-11-24",
        workDescription: "Synthetic", imageGroups: [{ category: "Synthetic", urls: [uploaded.fileUrl] }],
      });
      const referenced = await fetch(`${base}${uploaded.fileUrl}?variant=report-thumbnail`, { headers: { Authorization: `Bearer ${token(engineer)}` } });
      assert.equal(referenced.status, 200); await referenced.arrayBuffer();
    });
    await t.test("legacy thumbnail reads stream the original without creating derivatives", async () => {
      const filename = (await readdir(path.join(temporaryRoot, "uploads"))).find(name => name.startsWith("legacy-"));
      assert.ok(filename);
      const read = await fetch(`${new URL(url).origin}/api/uploads/${filename}?variant=report-thumbnail`, {
        headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(read.status, 200);
      assert.ok(read.headers.get("cache-control").includes("no-store"));
      assert.deepEqual(Buffer.from(await read.arrayBuffer()), legacyBytes);
      assert.equal((await readdir(path.join(temporaryRoot, "uploads"))).some(name =>
        name.startsWith(`report-preview-report-thumbnail-${filename}`)), false);
    });
    await t.test("PDF export embeds the prepared print image and keeps its group", async () => {
      const [report] = await db.insert(reportsTable).values({
        projectId: project.id, reportNumber: 1, type: "period",
        reportDate: "2026-11-24", periodStart: "2026-11-01", periodEnd: "2026-11-24",
        workDescription: "Synthetic PDF image round trip", progressPercentage: 42,
        status: "approved", imageUrls: [uploaded.fileUrl],
        imageGroups: [{ id: randomUUID(), category: "فحص الخرسانة", urls: [uploaded.fileUrl] }],
      }).returning();
      process.chdir(temporaryRoot);
      let response;
      try {
        response = await fetch(`${new URL(url).origin}/api/projects/${project.id}/reports/export-pdf?reportId=${report.id}`, {
          headers: { Authorization: `Bearer ${token(admin)}` }, signal: AbortSignal.timeout(30_000),
        });
      } finally { process.chdir(originalWorkingDirectory); }
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /application\/pdf/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
      assert.match(bytes.toString("latin1"), /\/Subtype\s*\/Image/);
    });
    await t.test("PDF export fails before sending a partial document when an image is missing", async () => {
      const [report] = await db.insert(reportsTable).values({
        projectId: project.id, reportNumber: 2, type: "period",
        reportDate: "2026-11-24", periodStart: "2026-11-01", periodEnd: "2026-11-24",
        workDescription: "Synthetic missing image", progressPercentage: 42,
        status: "approved", imageUrls: ["/api/uploads/missing-synthetic-image.jpg"],
      }).returning();
      process.chdir(temporaryRoot);
      let response;
      try {
        response = await fetch(`${new URL(url).origin}/api/projects/${project.id}/reports/export-pdf?reportId=${report.id}`, {
          headers: { Authorization: `Bearer ${token(admin)}` }, signal: AbortSignal.timeout(30_000),
        });
      } finally { process.chdir(originalWorkingDirectory); }
      assert.equal(response.status, 503);
      assert.ok(response.headers.get("content-type").includes("application/json"));
      assert.equal((await response.json()).code, "report_pdf_image_unavailable");
    });
    await t.test("project-file images use the shared profile and survive a lost-response retry", async () => {
      const fileUrl = `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/files/images/upload`;
      const packet = {
        mode: "source", clientKey: randomUUID(), fileName: "synthetic-file.jpg",
        mimeType: "image/jpeg", encoding: "webp", base64: source.toString("base64"),
        description: "Synthetic file image",
      };
      const postFile = () => fetch(fileUrl, {
        method: "POST", headers: { Authorization: `Bearer ${token(admin)}`, "Content-Type": "text/plain" },
        body: JSON.stringify(packet), signal: AbortSignal.timeout(30_000),
      });
      const writesBefore = written.size;
      const filesBefore = (await db.select().from(projectFilesTable)).length;
      const response = await postFile();
      assert.equal(response.status, 201);
      const file = await response.json();
      assert.equal(file.category, "image");
      assert.equal(file.description, packet.description);
      assert.match(file.filename, /^image-[a-f0-9-]+-[a-f0-9-]+\.webp$/);
      assert.equal(file.mimeType, "image/webp");
      assert.equal(written.size, writesBefore + 2);
      assert.ok(file.image.thumbnailKey);
      assert.equal(file.image.printKey, null);
      const listing = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/files?page=1&pageSize=24`, {
        headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(listing.status, 200);
      const page = await listing.json();
      assert.ok(page.files.some(row => row.id === file.id));
      assert.equal(page.summary.categories.image, filesBefore + 1);
      assert.equal(page.summary.totalFiles, filesBefore + 1);
      const retried = await postFile();
      assert.equal(retried.status, 201);
      assert.equal((await retried.json()).id, file.id);
      assert.equal(written.size, writesBefore + 2);
      const deleteResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/files/${file.id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(deleteResponse.status, 204, await deleteResponse.text());
      assert.equal((await db.select().from(projectFilesTable)).some(row => row.id === file.id), false);
      assert.equal((await db.select().from(imageAssetsTable)).some(row => row.projectFileId === file.id), false);
      assert.equal((await cloudBucket.file(`uploads/${file.filename}`).exists())[0], false);
    });
    await t.test("legacy multipart file images use the same durable lifecycle and thumbnail", async () => {
      const form = new FormData();
      form.set("file", new Blob([source], { type: "image/jpeg" }), "synthetic-multipart.jpg");
      form.set("category", "image");
      form.set("description", "Synthetic multipart image");
      const before = written.size;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/files`, {
        method: "POST", headers: { Authorization: `Bearer ${token(admin)}`, "Idempotency-Key": randomUUID() },
        body: form, signal: AbortSignal.timeout(30_000),
      });
      assert.equal(response.status, 201, await response.clone().text());
      const file = await response.json();
      assert.equal(file.category, "image");
      assert.equal(file.description, "Synthetic multipart image");
      assert.equal(file.image.profile, "file_image");
      assert.ok(file.image.thumbnailKey);
      assert.equal(file.image.printKey, null);
      assert.equal(written.size, before + 2);
      const bulkDeleteResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/files/images/bulk`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token(admin)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [file.id] }),
      });
      const bulkDeleteBody = await bulkDeleteResponse.text();
      assert.equal(bulkDeleteResponse.status, 200, bulkDeleteBody);
      assert.deepEqual(JSON.parse(bulkDeleteBody), { requestedCount: 1, deletedCount: 1 });
      assert.equal((await db.select().from(projectFilesTable)).some(row => row.id === file.id), false);
      assert.equal((await cloudBucket.file(`uploads/${file.filename}`).exists())[0], false);
    });
    await t.test("company raster logos use the alpha-preserving profile and isolated storage", async () => {
      const logo = await sharp({ create: {
        width: 180, height: 120, channels: 4, background: { r: 220, g: 30, b: 60, alpha: 0.5 },
      } }).png().toBuffer();
      const form = new FormData();
      form.set("name", "Synthetic logo company");
      form.set("type", "owner");
      form.set("clientKey", randomUUID());
      form.set("logo", new Blob([logo], { type: "image/png" }), "synthetic-logo.png");
      const writesBefore = written.size;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/companies`, {
        method: "POST", headers: { Authorization: `Bearer ${token(admin)}` }, body: form,
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(response.status, 201);
      const company = await response.json();
      assert.equal(company.name, "Synthetic logo company");
      assert.match(company.logoUrl, /^\/api\/uploads\/image-[a-f0-9-]+-[a-f0-9-]+\.png$/);
      assert.equal(written.size, writesBefore + 1);
      const assets = await db.select().from(imageAssetsTable);
      const logoAsset = assets.find(asset => asset.storageKey === `uploads/${company.logoUrl.split("/").pop()}`);
      assert.ok(logoAsset);
      assert.equal(logoAsset.profile, "logo");
      assert.equal(logoAsset.storageBucket, bucketId);
      const publicLogo = await fetch(`http://127.0.0.1:${server.address().port}${company.logoUrl}`);
      assert.equal(publicLogo.status, 200);
      assert.equal(publicLogo.headers.get("content-type"), "image/png");
      assert.ok((await publicLogo.arrayBuffer()).byteLength > 0);
      const deletion = await fetch(`http://127.0.0.1:${server.address().port}/api/companies/${company.id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(deletion.status, 200);
      assert.equal((await db.select().from(companiesTable)).some(row => row.id === company.id), false);
      assert.equal((await db.select().from(imageAssetsTable)).some(asset => asset.id === logoAsset.id), false);
      assert.equal((await cloudBucket.file(`uploads/${company.logoUrl.split("/").pop()}`).exists())[0], false);
    });
    await t.test("company SVG and static GIF logos use the same safe lifecycle", async () => {
      const formats = [
        {
          name: "SVG",
          filename: "synthetic-safe-logo.svg",
          mime: "image/svg+xml",
          bytes: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">
            <script>fetch('https://attacker.invalid/')</script>
            <image href="https://attacker.invalid/pixel.png"/>
            <rect x="0" y="0" width="80" height="40" fill="#1a2b3c" onload="alert(1)"/>
          </svg>`),
        },
        {
          name: "GIF",
          filename: "synthetic-static-logo.gif",
          mime: "image/gif",
          bytes: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
        },
      ];
      for (const format of formats) {
        const form = new FormData();
        form.set("name", `Synthetic ${format.name} company`);
        form.set("type", "owner");
        form.set("clientKey", randomUUID());
        form.set("logo", new Blob([format.bytes], { type: format.mime }), format.filename);
        const writesBefore = written.size;
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/companies`, {
          method: "POST", headers: { Authorization: `Bearer ${token(admin)}` }, body: form,
          signal: AbortSignal.timeout(30_000),
        });
        assert.equal(response.status, 201, await response.clone().text());
        const company = await response.json();
        assert.match(company.logoUrl, /^\/api\/uploads\/image-[a-f0-9-]+-[a-f0-9-]+\.png$/);
        assert.equal(written.size, writesBefore + 1);
        const logoAsset = (await db.select().from(imageAssetsTable))
          .find(asset => asset.storageKey === `uploads/${company.logoUrl.split("/").pop()}`);
        assert.ok(logoAsset);
        assert.equal(logoAsset.profile, "logo");
        assert.equal(logoAsset.storageBucket, bucketId);
        const publicLogo = await fetch(`http://127.0.0.1:${server.address().port}${company.logoUrl}`);
        assert.equal(publicLogo.status, 200);
        assert.equal(publicLogo.headers.get("content-type"), "image/png");
        assert.ok((await publicLogo.arrayBuffer()).byteLength > 0);
        const deletion = await fetch(`http://127.0.0.1:${server.address().port}/api/companies/${company.id}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token(admin)}` },
        });
        assert.equal(deletion.status, 200);
        assert.equal((await cloudBucket.file(`uploads/${company.logoUrl.split("/").pop()}`).exists())[0], false);
      }
      const animated = Buffer.from("R0lGODlhAQABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAgAAA/wAAAAICRAEAOw==", "base64");
      const form = new FormData();
      form.set("name", "Synthetic animated GIF company");
      form.set("type", "owner");
      form.set("clientKey", randomUUID());
      form.set("logo", new Blob([animated], { type: "image/gif" }), "synthetic-animated-logo.gif");
      const writesBefore = written.size;
      const rejected = await fetch(`http://127.0.0.1:${server.address().port}/api/companies`, {
        method: "POST", headers: { Authorization: `Bearer ${token(admin)}` }, body: form,
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(rejected.status, 415);
      assert.equal(written.size, writesBefore);
      assert.equal((await db.select().from(companiesTable)).some(row => row.name === "Synthetic animated GIF company"), false);
    });
    await t.test("web and mobile attendance use the shared lifecycle and retry safely", async () => {
      const attendanceUrl = `http://127.0.0.1:${server.address().port}/api/attendance/projects/${project.id}/check-in`;
      const clientId = randomUUID();
      const packet = {
        clientId, latitude: 0, longitude: 0, accuracy: 4,
        selfieBase64: source.toString("base64"),
      };
      const postAttendance = () => fetch(attendanceUrl, {
        method: "POST", headers: { Authorization: `Bearer ${token(admin)}`, "Content-Type": "text/plain" },
        body: JSON.stringify(packet), signal: AbortSignal.timeout(30_000),
      });
      const writesBefore = written.size;
      const response = await postAttendance();
      assert.equal(response.status, 201);
      const record = await response.json();
      assert.equal(record.clientId, clientId);
      assert.match(record.selfieFilename, /^image-[a-f0-9-]+-[a-f0-9-]+\.jpg$/);
      const asset = (await db.select().from(imageAssetsTable))
        .find(row => row.storageKey === `uploads/${record.selfieFilename}`);
      assert.ok(asset);
      assert.equal(asset.profile, "attendance");
      assert.equal(written.size, writesBefore + 1);
      const photo = await fetch(`http://127.0.0.1:${server.address().port}${record.selfieUrl}`, {
        headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get("cache-control"), "no-store, no-cache, must-revalidate, private");
      assert.ok((await photo.arrayBuffer()).byteLength > 0);
      const retry = await postAttendance();
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).id, record.id);
      assert.equal(written.size, writesBefore + 1);
      const checkOutId = randomUUID();
      const postCheckOut = () => {
        const form = new FormData();
        form.set("clientId", checkOutId);
        form.set("latitude", "0");
        form.set("longitude", "0");
        form.set("selfie", new Blob([source], { type: "image/jpeg" }), "synthetic-check-out.jpg");
        return fetch(`http://127.0.0.1:${server.address().port}/api/attendance/projects/${project.id}/check-out`, {
          method: "POST", headers: { Authorization: `Bearer ${token(admin)}` }, body: form,
          signal: AbortSignal.timeout(30_000),
        });
      };
      const webResponse = await postCheckOut();
      assert.equal(webResponse.status, 201);
      const checkOut = await webResponse.json();
      assert.match(checkOut.selfieFilename, /^image-[a-f0-9-]+-[a-f0-9-]+\.jpg$/);
      assert.equal(written.size, writesBefore + 2);
      const webRetry = await postCheckOut();
      assert.equal(webRetry.status, 200);
      assert.equal((await webRetry.json()).id, checkOut.id);
      const checkOutDelete = await fetch(`http://127.0.0.1:${server.address().port}/api/attendance/records/${checkOut.id}?reason=synthetic%20test`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(checkOutDelete.status, 204);
      const deletion = await fetch(`http://127.0.0.1:${server.address().port}/api/attendance/records/${record.id}?reason=synthetic%20test`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token(admin)}` },
      });
      assert.equal(deletion.status, 204);
      assert.equal((await db.select().from(imageAssetsTable)).some(row => row.id === asset.id), false);
      assert.equal((await cloudBucket.file(`uploads/${record.selfieFilename}`).exists())[0], false);
    });
    await t.test("5 MB and near-20 MiB inputs obey the technical-detail size policy", async () => {
      const measurements = [];
      for (const { width, height, label } of [
        { width: 1300, height: 1300, label: "about-5mb" },
      ]) {
        let pixels = randomBytes(width * height * 3);
        let original = await sharp(pixels, { raw: { width, height, channels: 3 } })
          .png({ compressionLevel: 1 }).toBuffer();
        pixels = Buffer.alloc(0);
        assert.ok(original.length >= 5_000_000, `${label}: source should be at least five decimal megabytes`);
        assert.ok(original.length <= 20 * 1024 * 1024, `${label}: source must respect the shared 20 MiB cap`);
        const packet = {
          mode: "source", clientKey: randomUUID(), fileName: `synthetic-${label}.png`,
          mimeType: "image/png", encoding: "webp", qualityProfile: "report_technical",
          base64: original.toString("base64"),
        };
        const startedAt = performance.now();
        const response = await fetch(url, {
          method: "POST", headers: { Authorization: `Bearer ${token(admin)}`, "Content-Type": "text/plain" },
          body: JSON.stringify(packet), signal: AbortSignal.timeout(90_000),
        });
        const elapsedMs = performance.now() - startedAt;
        assert.equal(response.status, 201, `${label}: ${await response.clone().text()}`);
        const result = await response.json();
        assert.equal(result.image.state, "ready");
        assert.equal(result.image.profile, "report_technical");
        assert.ok(result.image.width <= 1600 && result.image.height <= 1600);
        assert.ok(result.fileSize <= 1536 * 1024);
        assert.ok(result.exceptions.some(item => item.code === "user_declared_technical_detail"));
        measurements.push({
          label, sourceBytes: original.length, responseTimeMs: Math.round(elapsedMs),
          outputBytes: result.fileSize, outputWidth: result.image.width, outputHeight: result.image.height,
          exceptions: result.exceptions,
        });
        packet.base64 = "";
        original = Buffer.alloc(0);
      }
      const lines = Array.from({ length: 36 }, (_, index) =>
        `<path d="M${120 + index * 95} 120V2880" stroke="${index % 3 ? "#b7c3cc" : "#315c76"}" stroke-width="${index % 3 ? 2 : 5}"/>`,
      ).join("");
      const drawing = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000">
        <rect width="4000" height="3000" fill="#eeeae2"/><g>${lines}</g>
        <path d="M500 500 L3300 500 L3300 2480 L500 2480 Z" fill="none" stroke="#9d4d32" stroke-width="22"/>
        <text x="600" y="450" font-size="90" fill="#183447">SYNTHETIC REINFORCEMENT DETAIL</text>
        <path d="M700 1200H3200M700 1600H3200M700 2000H3200" stroke="#244f68" stroke-width="18"/>
      </svg>`);
      const compactPhoto = await sharp(drawing).jpeg({ quality: 98 }).toBuffer();
      let original = padJpegWithComments(compactPhoto, 20 * 1024 * 1024 - 64 * 1024);
      assert.ok(original.length >= 19_000_000 && original.length <= IMAGE_SOURCE_MAX_BYTES);
      const nearTwenty = {
        mode: "source", clientKey: randomUUID(), fileName: "synthetic-phone-detail.jpg",
        mimeType: "image/jpeg", encoding: "webp", qualityProfile: "report_technical",
        base64: original.toString("base64"),
      };
      const startedAt = performance.now();
      const response = await fetch(url, {
        method: "POST", headers: { Authorization: `Bearer ${token(admin)}`, "Content-Type": "text/plain" },
        body: JSON.stringify(nearTwenty), signal: AbortSignal.timeout(90_000),
      });
      const elapsedMs = performance.now() - startedAt;
      assert.equal(response.status, 201, `near-20mib: ${await response.clone().text()}`);
      const result = await response.json();
      assert.equal(result.image.profile, "report_technical");
      assert.ok(result.image.width <= 1600 && result.image.height <= 1600);
      assert.ok(result.fileSize <= 1536 * 1024);
      assert.ok(result.exceptions.some(item => item.code === "user_declared_technical_detail"));
      measurements.push({
        label: "near-20mib-photo-with-large-metadata",
        sourceBytes: original.length, responseTimeMs: Math.round(elapsedMs),
        outputBytes: result.fileSize, outputWidth: result.image.width, outputHeight: result.image.height,
        exceptions: result.exceptions,
      });
      nearTwenty.base64 = "";
      original = Buffer.alloc(0);

      let pixels = randomBytes(2550 * 2550 * 3);
      let noisy = await sharp(pixels, { raw: { width: 2550, height: 2550, channels: 3 } })
        .png({ compressionLevel: 1 }).toBuffer();
      pixels = Buffer.alloc(0);
      assert.ok(noisy.length >= 19_000_000 && noisy.length <= IMAGE_SOURCE_MAX_BYTES);
      const writesBefore = written.size;
      const noisyPacket = {
        mode: "source", clientKey: randomUUID(), fileName: "synthetic-uncompressible.png",
        mimeType: "image/png", encoding: "webp", qualityProfile: "report_technical",
        base64: noisy.toString("base64"),
      };
      const rejectionStarted = performance.now();
      const rejected = await fetch(url, {
        method: "POST", headers: { Authorization: `Bearer ${token(admin)}`, "Content-Type": "text/plain" },
        body: JSON.stringify(noisyPacket), signal: AbortSignal.timeout(90_000),
      });
      const rejection = await rejected.json();
      assert.equal(rejected.status, 413);
      assert.equal(rejection.code, "quality_preserving_output_too_large");
      assert.equal(written.size, writesBefore);
      measurements.push({
        label: "near-20mib-high-entropy-rejected",
        sourceBytes: noisy.length, responseTimeMs: Math.round(performance.now() - rejectionStarted),
        status: rejected.status, code: rejection.code, storedObjects: 0,
      });
      noisyPacket.base64 = "";
      pixels = Buffer.alloc(0);
      noisy = Buffer.alloc(0);
      await mkdir(path.resolve("generated-artifacts/image-audit"), { recursive: true });
      await writeFile(path.resolve("generated-artifacts/image-audit/large-source-upload.json"),
        JSON.stringify({ measurements }, null, 2));
    });
    await t.test("technical report profile records its declared exception under 1.5 MB", async () => {
      const technical = {
        ...packet, clientKey: randomUUID(), qualityProfile: "report_technical",
      };
      const response = await post(technical);
      assert.equal(response.status, 201, await response.clone().text());
      const result = await response.json();
      assert.equal(result.image.profile, "report_technical");
      assert.ok(result.image.byteSize <= 1536 * 1024);
      assert.ok(result.exceptions.some(item => item.code === "user_declared_technical_detail"));
      assert.ok(result.image.thumbnailKey);
      assert.ok(result.image.printKey);
      technical.base64 = "";
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (cloudBucket) for (const name of written) await cloudBucket.file(name).delete({ ignoreNotFound: true });
    if (pool) await pool.end();
    if (originalWorkingDirectory) process.chdir(originalWorkingDirectory);
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    await pg.stop();
  }
});
