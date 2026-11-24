import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { once } from "node:events";
import { createServer } from "node:http";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

test("report image sections persist empty groups and public links upload only into one section", {
  timeout: 120_000,
}, async () => {
  assert.equal(process.env.NODE_ENV, "development", "isolated fixtures run only in development mode");
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousBucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const bucketId = process.env.IMAGE_AUDIT_BUCKET_ID;
  assert.ok(bucketId && bucketId !== previousBucket, "an independent development image bucket is required");
  process.env.JWT_SECRET = "test-only-report-image-share-secret";
  delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/not-used";
  const postgres = await isolatedPostgres();
  let server;
  let schema;
  let objectStorageClient;
  let originalBucket;
  let auditBucket;
  const createdFilenames = new Set();
  const createdObjects = new Set();
  try {
    const sharp = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("sharp");
    const storage = await import("../artifacts/api-server/src/lib/objectStorage.ts");
    objectStorageClient = storage.objectStorageClient;
    originalBucket = objectStorageClient.bucket.bind(objectStorageClient);
    objectStorageClient.bucket = (id, ...args) => {
      if (id !== bucketId) throw new Error("Nonisolated object storage refused");
      const result = originalBucket(id, ...args);
      const file = result.file.bind(result);
      result.file = (name, ...fileArgs) => {
        const object = file(name, ...fileArgs);
        const createWriteStream = object.createWriteStream.bind(object);
        object.createWriteStream = (...streamArgs) => {
          createdObjects.add(name);
          return createWriteStream(...streamArgs);
        };
        return object;
      };
      return result;
    };
    auditBucket = originalBucket(bucketId);
    const [{ default: app }, { signToken }, dbSchema, drizzle] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
      import("../lib/db/src/index.ts"),
      import("../lib/db/node_modules/drizzle-orm/index.js"),
    ]);
    schema = dbSchema;
    const {
      db, projectsTable, reportsTable, projectFilesTable, reportImageSharesTable,
      reportImageShareUploadsTable, usersTable,
    } = dbSchema;
    const { eq } = drizzle;
    const [user] = await db.insert(usersTable).values({
      phone: `report-share-${Date.now()}`,
      passwordHash: "unused",
      fullName: "Report share test",
      role: "admin",
    }).returning();
    const [project] = await db.insert(projectsTable).values({
      name: "Report image share test",
      location: "fixture",
      ownerEntity: "fixture",
      supervisorEntity: "fixture",
      contractor: "fixture",
      noSchedule: true,
    }).returning();
    const token = signToken({ userId: user.id, phone: user.phone, role: user.role });
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    server = createServer(app).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const createResponse = await fetch(`${base}/projects/${project.id}/reports`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        type: "weekly",
        reportDate: "2026-11-20",
        periodStart: "2026-11-16",
        periodEnd: "2026-11-20",
        workDescription: "Test empty report sections.",
        progressPercentage: 0,
        progressSource: "manual",
        imageGroups: [
          { category: "الأعمال الإنشائية", urls: [] },
          { category: "الأعمال الكهربائية", urls: [] },
        ],
      }),
    });
    const createdReport = await createResponse.json();
    assert.equal(createResponse.status, 201, JSON.stringify(createdReport));
    assert.equal(createdReport.imageGroups.length, 2, "empty sections remain saved");
    assert.equal(createdReport.imageUrls.length, 0);

    const listResponse = await fetch(`${base}/projects/${project.id}/reports`, { headers: authHeaders });
    const listedReports = await listResponse.json();
    assert.equal(listResponse.status, 200, JSON.stringify(listedReports));
    assert.equal(listedReports.length, 1);
    assert.equal(listedReports[0].id, createdReport.id);

    const updateResponse = await fetch(`${base}/projects/${project.id}/reports/${createdReport.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        imageGroups: createdReport.imageGroups,
        imageUrls: [],
      }),
    });
    assert.equal(updateResponse.status, 200, await updateResponse.text());
    const detailResponse = await fetch(`${base}/projects/${project.id}/reports/${createdReport.id}`, { headers: authHeaders });
    const detail = await detailResponse.json();
    assert.equal(detail.imageGroups.length, 2, "empty groups remain after editing");

    const shareResponse = await fetch(
      `${base}/projects/${project.id}/reports/${createdReport.id}/image-groups/0/share`,
      { method: "POST", headers: authHeaders },
    );
    const shareCreated = await shareResponse.json();
    assert.equal(shareResponse.status, 201, JSON.stringify(shareCreated));
    assert.match(shareCreated.publicToken, /^[A-Za-z0-9_-]{40,100}$/);
    const storedShare = await db.select().from(reportImageSharesTable)
      .where(eq(reportImageSharesTable.id, shareCreated.shareId));
    assert.notEqual(storedShare[0].tokenHash, shareCreated.publicToken, "database stores only the token hash");
    assert.equal(storedShare[0].groupId, detail.imageGroups[0].id);

    const publicUrl = `${base}/public/report-image-shares?token=${encodeURIComponent(shareCreated.publicToken)}`;
    const publicInfoResponse = await fetch(publicUrl);
    const publicInfo = await publicInfoResponse.json();
    assert.equal(publicInfoResponse.status, 200);
    assert.deepEqual(Object.keys(publicInfo).sort(), [
      "category", "expiresAt", "maxImages", "periodEnd", "periodStart", "status", "uploadedCount",
    ]);
    assert.equal(publicInfo.category, "الأعمال الإنشائية");
    assert.equal(publicInfo.periodStart, "2026-11-16");
    assert.equal(publicInfo.periodEnd, "2026-11-20");

    const largeNonImageBase64 = Buffer.alloc(6 * 1024 * 1024).toString("base64");
    const largeRejectedResponse = await fetch(`${base}/public/report-image-shares/upload`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        token: shareCreated.publicToken,
        fileName: "synthetic-invalid-image.jpg",
        mimeType: "image/jpeg",
        imageBase64: largeNonImageBase64,
      }),
    });
    assert.equal(largeRejectedResponse.status, 413, "oversized share images fail before image processing");

    const jpeg = await sharp({ create: {
      width: 640, height: 480, channels: 3, background: "#587080",
    } }).jpeg({ quality: 82 }).toBuffer();
    const uploadPacket = {
      clientKey: randomUUID(),
      fileName: "site-photo.jpg",
      mimeType: "image/jpeg",
      encoding: "jpeg",
      base64: jpeg.toString("base64"),
    };
    const uploadUrl = `${base}/public/report-image-shares/upload?token=${encodeURIComponent(shareCreated.publicToken)}`;
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(uploadPacket),
    });
    const uploadResult = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201, JSON.stringify(uploadResult));
    assert.equal(uploadResult.uploadedCount, 1);
    const writesAfterUpload = createdObjects.size;
    const retryResponse = await fetch(uploadUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(uploadPacket),
    });
    assert.equal(retryResponse.status, 200);
    assert.equal((await retryResponse.json()).uploadedCount, 1);
    assert.equal(createdObjects.size, writesAfterUpload, "a lost-response retry does not write duplicate image variants");
    assert.equal((await db.select().from(reportImageShareUploadsTable)).length, 1);
    const legacyPacket = {
      token: shareCreated.publicToken, fileName: "legacy-site-photo.jpg", mimeType: "image/jpeg",
      imageBase64: jpeg.toString("base64"),
    };
    const legacyUpload = () => fetch(`${base}/public/report-image-shares/upload`, {
      method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(legacyPacket),
    });
    const legacyFirst = await legacyUpload();
    assert.equal(legacyFirst.status, 201);
    const legacyRetry = await legacyUpload();
    assert.equal(legacyRetry.status, 200, "older body-token clients use a stable content identity");
    assert.equal((await legacyRetry.json()).uploadedCount, 2);
    assert.equal((await db.select().from(reportImageShareUploadsTable)).length, 2);

    const updatedReport = await (await fetch(`${base}/projects/${project.id}/reports/${createdReport.id}`, { headers: authHeaders })).json();
    assert.equal(updatedReport.imageGroups[0].urls.length, 2);
    assert.equal(updatedReport.imageGroups[0].shareStatus, "uploading");
    assert.equal(updatedReport.imageGroups[1].urls.length, 0, "request data cannot redirect an image to another group");
    assert.equal(updatedReport.imageUrls.length, 2);
    const storedFiles = await db.select().from(projectFilesTable).where(eq(projectFilesTable.projectId, project.id));
    createdFilenames.add(storedFiles[0].filename);
    const privateFileResponse = await fetch(`http://127.0.0.1:${server.address().port}${storedFiles[0].fileUrl}`);
    assert.equal(privateFileResponse.status, 401, "the public upload link does not grant access to stored photos");

    const orderedShareResponse = await fetch(
      `${base}/projects/${project.id}/reports/${createdReport.id}/image-groups/1/share`,
      { method: "POST", headers: authHeaders },
    );
    const orderedShare = await orderedShareResponse.json();
    assert.equal(orderedShareResponse.status, 201, JSON.stringify(orderedShare));
    const orderedUploadUrl = `${base}/public/report-image-shares/upload?token=${encodeURIComponent(orderedShare.publicToken)}`;
    const orderedPackets = await Promise.all(["#b04030", "#3050b0"].map(async color => ({
      clientKey: randomUUID(),
      fileName: "site-photo.jpg",
      mimeType: "image/jpeg",
      base64: (await sharp({ create: {
        width: 480, height: 320, channels: 3, background: color,
      } }).jpeg({ quality: 82 }).toBuffer()).toString("base64"),
    })));
    const postSharePacket = async (packet, attempt = 0) => {
      const response = await fetch(orderedUploadUrl, {
        method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(packet),
      });
      if (response.status === 429 && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return postSharePacket(packet, attempt + 1);
      }
      return response;
    };
    const concurrentResponses = await Promise.all(orderedPackets.map(packet => postSharePacket(packet)));
    assert.deepEqual(concurrentResponses.map(response => response.status).sort(), [201, 201]);
    const orderedAttempts = (await db.select().from(reportImageShareUploadsTable)
      .where(eq(reportImageShareUploadsTable.shareId, orderedShare.shareId)))
      .sort((left, right) => left.position - right.position);
    const orderedReport = await (await fetch(
      `${base}/projects/${project.id}/reports/${createdReport.id}`, { headers: authHeaders },
    )).json();
    assert.deepEqual(
      orderedReport.imageGroups[1].urls,
      orderedAttempts.map(attempt => attempt.fileUrl),
      "completion order does not change the reserved image order",
    );

    const completionResponse = await fetch(`${base}/public/report-image-shares/complete`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ token: shareCreated.publicToken }),
    });
    assert.equal(completionResponse.status, 200);
    const completedReport = await (await fetch(`${base}/projects/${project.id}/reports/${createdReport.id}`, { headers: authHeaders })).json();
    assert.equal(completedReport.imageGroups[0].shareStatus, "completed");
    assert.equal((await fetch(publicUrl)).status, 410, "completed links cannot be reused");

    const cancelResponse = await fetch(
      `${base}/projects/${project.id}/reports/${createdReport.id}/image-groups/1/share`,
      { method: "POST", headers: authHeaders },
    );
    const cancelShare = await cancelResponse.json();
    assert.equal(cancelResponse.status, 201);
    const cancelledResponse = await fetch(
      `${base}/projects/${project.id}/reports/${createdReport.id}/image-groups/1/share`,
      { method: "DELETE", headers: authHeaders },
    );
    assert.equal(cancelledResponse.status, 204);
    assert.equal((await fetch(`${base}/public/report-image-shares?token=${cancelShare.publicToken}`)).status, 410);

    const expiryResponse = await fetch(
      `${base}/projects/${project.id}/reports/${createdReport.id}/image-groups/1/share`,
      { method: "POST", headers: authHeaders },
    );
    const expiryShare = await expiryResponse.json();
    assert.equal(expiryResponse.status, 201);
    await db.update(reportImageSharesTable).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(reportImageSharesTable.id, expiryShare.shareId));
    assert.equal(
      (await fetch(`${base}/public/report-image-shares?token=${expiryShare.publicToken}`)).status,
      410,
      "expired links are rejected",
    );
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (schema?.db && createdFilenames.size > 0) {
      const { db, projectFilesTable } = schema;
      const files = await db.select().from(projectFilesTable);
      for (const file of files) {
        if (createdFilenames.has(file.filename)) {
          await unlink(path.join("uploads", file.filename)).catch(() => {});
        }
      }
    }
    if (auditBucket) for (const name of createdObjects) await auditBucket.file(name).delete({ ignoreNotFound: true });
    if (objectStorageClient && originalBucket) objectStorageClient.bucket = originalBucket;
    if (schema?.pool) await schema.pool.end();
    await postgres.stop();
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousBucket === undefined) delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    else process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = previousBucket;
  }
});
