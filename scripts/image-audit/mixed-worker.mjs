// This process is launched only by mixed.mjs after it has created a private
// PostgreSQL cluster, a private working directory and checked the test bucket.
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { requireApi, root, sharp } from "./common.mjs";

assert.equal(process.env.IMAGE_AUDIT_CHILD, "isolated-mixed");
assert.equal(process.env.NODE_ENV, "development");
assert.ok(process.env.DATABASE_URL?.includes("image-audit") || process.env.DATABASE_URL?.includes("excel-http-pg-"));
assert.ok(process.env.IMAGE_AUDIT_BUCKET_ID);
assert.ok(process.env.IMAGE_AUDIT_BUCKET_ID !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID, "Separate test storage required");
process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = process.env.IMAGE_AUDIT_BUCKET_ID;
process.chdir(process.argv[2]);
await mkdir("src", { recursive: true });
await symlink(path.join(root, "artifacts/api-server/src/fonts"), "src/fonts", "dir");

const { objectStorageClient } = await import("../../artifacts/api-server/src/lib/objectStorage.ts");
const originalBucket = objectStorageClient.bucket.bind(objectStorageClient);
function recordObject(key) {
  assert.match(key, /^uploads\/[a-zA-Z0-9._/-]+$/);
  assert.ok(!key.includes(".."));
  // Written before network I/O, so a killed API cannot lose its cleanup list.
  appendFileSync("written-objects.ndjson", `${JSON.stringify(key)}\n`);
  process.send?.({ kind: "object", key });
}
// Observe real SDK writes (no fake storage). The parent keeps an exact cleanup
// ledger even if the resource guard terminates this API process.
objectStorageClient.bucket = (...args) => {
  const bucket = originalBucket(...args);
  const upload = bucket.upload.bind(bucket);
  bucket.upload = (local, options) => {
    recordObject(options.destination);
    return upload(local, options);
  };
  const file = bucket.file.bind(bucket);
  bucket.file = (...args) => {
    const object = file(...args);
    const save = object.save.bind(object);
    object.save = (...args) => {
      recordObject(object.name);
      return save(...args);
    };
    const createWriteStream = object.createWriteStream.bind(object);
    object.createWriteStream = (...args) => {
      recordObject(object.name);
      return createWriteStream(...args);
    };
    return object;
  };
  return bucket;
};
const schema = await import("../../lib/db/src/index.ts");
const { db, pool, usersTable, projectsTable, reportsTable, projectFilesTable, newRequestMetrics, requestMetrics } = schema;
const { signToken } = await import("../../artifacts/api-server/src/lib/auth.ts");
const express = requireApi("express");
const routers = await Promise.all([
  import("../../artifacts/api-server/src/routes/files.ts"),
  import("../../artifacts/api-server/src/routes/reports.ts"),
  import("../../artifacts/api-server/src/routes/projects.ts"),
  import("../../artifacts/api-server/src/routes/attendance.ts"),
  import("../../artifacts/api-server/src/routes/pdf.ts"),
]);
const users = await db.insert(usersTable).values(Array.from({ length: 6 }, (_, index) => ({
  phone: `image-audit-${index}`, fullName: "Synthetic image audit", passwordHash: "unused", role: "admin",
}))).returning();
const tokens = users.map(user => signToken({ userId: user.id, phone: user.phone, role: user.role }));
const projects = await db.insert(projectsTable).values(users.map((_, index) => ({
  name: `Synthetic image load ${index + 1}`, location: "Synthetic", ownerEntity: "Synthetic",
  supervisorEntity: "Synthetic", contractor: "Synthetic", noSchedule: true,
}))).returning();
await mkdir("uploads", { recursive: true });
const thumbnail = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#526e82" } }).jpeg().toBuffer();
const reportRows = [];
for (const [projectIndex, project] of projects.entries()) {
  const imageUrls = [];
  for (let index = 0; index < 10; index++) {
    const filename = `synthetic-peer-${projectIndex}-${index}.jpg`;
    await writeFile(path.join("uploads", filename), thumbnail);
    imageUrls.push(`/api/uploads/${filename}`);
    await db.insert(projectFilesTable).values({
      projectId: project.id, filename, originalName: filename, category: "image",
      fileUrl: imageUrls.at(-1), fileSize: thumbnail.length, mimeType: "image/jpeg",
    });
  }
  reportRows.push({
    projectId: project.id, type: "weekly", reportDate: "2026-11-24", periodStart: "2026-11-18",
    periodEnd: "2026-11-24", workDescription: "Synthetic report body", imageUrls,
    imageGroups: [{ id: `synthetic-peer-group-${projectIndex}`, category: "Synthetic", urls: imageUrls }],
    activitiesSnapshot: [], status: "approved",
  });
}
const reports = await db.insert(reportsTable).values(reportRows).returning();
const app = express();
const observations = [];
let currentPhase = "warmup";
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
eventLoop.enable();
app.use((req, res, next) => {
  const metrics = newRequestMetrics();
  const at = performance.now();
  currentPhase = typeof req.headers["x-image-audit-phase"] === "string"
    ? req.headers["x-image-audit-phase"] : "warmup";
  res.on("finish", () => observations.push({
    operation: req.headers["x-image-audit-operation"] ?? "unknown",
    phase: req.headers["x-image-audit-phase"] ?? "unknown", status: res.statusCode,
    requestId: req.headers["x-image-audit-request-id"] ?? null,
    serverMs: performance.now() - at, ...metrics,
  }));
  requestMetrics.run(metrics, next);
});
app.use("/api", (await import("../../artifacts/api-server/src/routes/report-image-uploads.ts")).default);
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ type: "text/plain", limit: "22mb" }));
app.use((req, _res, next) => {
  if (typeof req.body === "string") req.body = JSON.parse(req.body);
  next();
});
// PDF's specific export path must precede reports' /:reportId matcher.
app.use("/api", routers[4].default, ...routers.slice(0, 4).map(module => module.default));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const cpu = process.cpuUsage();
const began = performance.now();
const snapshot = () => ({
  kind: "snapshot", elapsedMs: performance.now() - began, phase: currentPhase,
  memory: process.memoryUsage(), cpu: process.cpuUsage(cpu),
  eventLoop: { p95Ms: eventLoop.percentile(95) / 1e6, maxMs: eventLoop.max / 1e6 },
  observations,
});
const ticker = setInterval(() => process.send?.(snapshot()), 500);
try {
  // Tokens travel only over the private parent/child IPC channel. They are
  // never included in observations, stdout, files or final evidence.
  process.send?.({
    kind: "ready", origin,
    projectIds: projects.map(project => project.id),
    reportIds: reports.map(report => report.id), tokens,
  });
  await new Promise(resolve => process.on("message", message => { if (message.kind === "stop") resolve(); }));
  process.send?.({ ...snapshot(), kind: "result" });
} finally {
  clearInterval(ticker);
  eventLoop.disable();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
}
process.exit(0); // no persistent worker timers may outlive this isolated test.
