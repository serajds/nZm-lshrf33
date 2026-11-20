import assert from "node:assert/strict";
import test from "node:test";
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
  process.env.JWT_SECRET = "test-only-report-image-share-secret";
  delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/not-used";
  const postgres = await isolatedPostgres();
  let server;
  let schema;
  const createdFilenames = new Set();
  try {
    const [{ default: app }, { signToken }, dbSchema, drizzle] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
      import("../lib/db/src/index.ts"),
      import("../lib/db/node_modules/drizzle-orm/index.js"),
    ]);
    schema = dbSchema;
    const { db, projectsTable, reportsTable, projectFilesTable, reportImageSharesTable, usersTable } = dbSchema;
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
    assert.deepEqual(Object.keys(publicInfo).sort(), ["category", "expiresAt", "periodEnd", "periodStart", "status"]);
    assert.equal(publicInfo.category, "الأعمال الإنشائية");
    assert.equal(publicInfo.periodStart, "2026-11-16");
    assert.equal(publicInfo.periodEnd, "2026-11-20");

    const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2p8AAAAASUVORK5CYII=";
    const uploadResponse = await fetch(`${base}/public/report-image-shares/upload`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        token: shareCreated.publicToken,
        fileName: "photo.png",
        mimeType: "image/png",
        imageBase64: onePixelPng,
        groupId: detail.imageGroups[1].id,
      }),
    });
    const uploadResult = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201, JSON.stringify(uploadResult));

    const updatedReport = await (await fetch(`${base}/projects/${project.id}/reports/${createdReport.id}`, { headers: authHeaders })).json();
    assert.equal(updatedReport.imageGroups[0].urls.length, 1);
    assert.equal(updatedReport.imageGroups[0].shareStatus, "uploading");
    assert.equal(updatedReport.imageGroups[1].urls.length, 0, "request data cannot redirect an image to another group");
    assert.equal(updatedReport.imageUrls.length, 1);
    const storedFiles = await db.select().from(projectFilesTable).where(eq(projectFilesTable.projectId, project.id));
    createdFilenames.add(storedFiles[0].filename);
    const privateFileResponse = await fetch(`http://127.0.0.1:${server.address().port}${storedFiles[0].fileUrl}`);
    assert.equal(privateFileResponse.status, 401, "the public upload link does not grant access to stored photos");

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
    if (schema?.pool) await schema.pool.end();
    await postgres.stop();
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousBucket === undefined) delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    else process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = previousBucket;
  }
});
