import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const uploadsDir = path.join(apiDir, "uploads");
const enabled = process.env.NODE_ENV === "development"
  && process.env.SYSTEM_IMAGE_COMPRESSION_RESTART_TEST === "1";

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function noisyPixels(width, height) {
  const data = Buffer.alloc(width * height * 3);
  let seed = 123456789;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = seed >>> 24;
  }
  return data;
}

async function startApi(port) {
  const child = spawn(process.execPath, ["--enable-source-maps", "dist/index.mjs"], {
    cwd: apiDir,
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), LOG_LEVEL: "silent" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited before becoming ready: ${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (response.ok) return { child, output: () => output };
    } catch {
      // The process may still be starting.
    }
    await wait(100);
  }
  child.kill("SIGKILL");
  throw new Error(`API process did not become ready: ${output}`);
}

async function stopApi(child, signal = "SIGKILL") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await once(child, "close");
}

test("a real development API restart resumes a database-backed image batch", {
  skip: !enabled,
  timeout: 180_000,
}, async t => {
  const [{ db, systemImageCompressionJobsTable, systemImageCompressionItemsTable }, sharpModule] =
    await Promise.all([import("@workspace/db"), import("sharp")]);
  const sharp = sharpModule.default;
  const require = createRequire(new URL("../package.json", import.meta.url));
  const { eq, or } = require("drizzle-orm");
  const files = [
    { suffix: "large.jpg", assetKind: "project_file", mime: "image/jpeg" },
    { suffix: "logo.png", assetKind: "company_logo", mime: "image/png" },
  ].map(file => ({
    ...file,
    filename: `system-compression-restart-${randomUUID()}-${file.suffix}`,
  }));
  let jobId;
  let firstApi;
  let restartedApi;
  let databaseClosed = false;

  t.after(async () => {
    await Promise.all([
      firstApi ? stopApi(firstApi).catch(() => {}) : Promise.resolve(),
      restartedApi ? stopApi(restartedApi).catch(() => {}) : Promise.resolve(),
    ]);
    if (jobId !== undefined) {
      await db.delete(systemImageCompressionJobsTable)
        .where(eq(systemImageCompressionJobsTable.id, jobId));
    }
    for (const file of files) {
      await fs.rm(path.join(uploadsDir, file.filename), { force: true });
      const entries = await fs.readdir(uploadsDir).catch(() => []);
      await Promise.all(entries
        .filter(name => name.startsWith(`${file.filename}.compress-`))
        .map(name => fs.rm(path.join(uploadsDir, name), { force: true })));
    }
    if (!databaseClosed) await db.$client.end();
  });

  const regularApiIsRunning = await fetch("http://127.0.0.1:8080/api/healthz")
    .then(response => response.ok)
    .catch(() => false);
  assert.equal(
    regularApiIsRunning,
    false,
    "stop the configured API workflow so only the process under test can claim the batch",
  );
  const testPortIsOccupied = await fetch("http://127.0.0.1:8082/api/healthz")
    .then(() => true)
    .catch(() => false);
  assert.equal(testPortIsOccupied, false, "the dedicated test port must be available");

  const activeJobs = await db.select({ id: systemImageCompressionJobsTable.id })
    .from(systemImageCompressionJobsTable)
    .where(or(
      eq(systemImageCompressionJobsTable.status, "running"),
      eq(systemImageCompressionJobsTable.status, "pausing"),
    ));
  assert.deepEqual(activeJobs, [], "do not interfere with an active development batch");

  await fs.mkdir(uploadsDir, { recursive: true });
  const jpegSource = await sharp(noisyPixels(2000, 1200), {
    raw: { width: 2000, height: 1200, channels: 3 },
  }).jpeg({ quality: 100 }).toBuffer();
  const pngSource = await sharp({
    create: {
      width: 2200,
      height: 1400,
      channels: 4,
      background: { r: 26, g: 112, b: 156, alpha: 0.55 },
    },
  }).png().toBuffer();
  const originals = [jpegSource, pngSource];
  for (let index = 0; index < files.length; index++) {
    await fs.writeFile(path.join(uploadsDir, files[index].filename), originals[index], { flag: "wx" });
  }

  const [job] = await db.insert(systemImageCompressionJobsTable).values({
    status: "running",
    total: files.length,
  }).returning({ id: systemImageCompressionJobsTable.id });
  assert.ok(job);
  jobId = job.id;
  await db.insert(systemImageCompressionItemsTable).values(files.map((file, index) => ({
    jobId,
    filename: file.filename,
    assetKinds: [file.assetKind],
    sourceBytes: originals[index].length,
    sourceMimeType: file.mime,
  })));

  const port = 8082;
  firstApi = (await startApi(port)).child;
  const firstItemDeadline = Date.now() + 45_000;
  let batchItems = [];
  while (Date.now() < firstItemDeadline) {
    batchItems = await db.select().from(systemImageCompressionItemsTable)
      .where(eq(systemImageCompressionItemsTable.jobId, jobId))
      .orderBy(systemImageCompressionItemsTable.id);
    if (batchItems.some(item => item.status === "compressed" || item.status === "failed" || item.status === "skipped")) {
      break;
    }
    await wait(100);
  }
  assert.equal(batchItems.filter(item => item.status === "compressed").length, 1);
  assert.equal(batchItems.filter(item => item.status === "pending").length, 1);
  assert.equal(batchItems.reduce((sum, item) => sum + item.attempts, 0), 1);

  await stopApi(firstApi);
  firstApi = null;

  const interruptedJob = await db.select().from(systemImageCompressionJobsTable)
    .where(eq(systemImageCompressionJobsTable.id, jobId)).then(rows => rows[0]);
  assert.equal(interruptedJob.status, "running");
  assert.equal(interruptedJob.processed, 1);

  restartedApi = (await startApi(port)).child;
  const completionDeadline = Date.now() + 90_000;
  let completedJob;
  while (Date.now() < completionDeadline) {
    [completedJob] = await db.select().from(systemImageCompressionJobsTable)
      .where(eq(systemImageCompressionJobsTable.id, jobId));
    if (completedJob?.status === "completed" || completedJob?.status === "completed_with_errors") break;
    await wait(200);
  }

  assert.equal(completedJob?.status, "completed");
  assert.equal(completedJob.total, files.length);
  assert.equal(completedJob.processed, files.length);
  assert.equal(completedJob.compressed, files.length);
  assert.equal(completedJob.skipped, 0);
  assert.equal(completedJob.failed, 0);

  const finalItems = await db.select().from(systemImageCompressionItemsTable)
    .where(eq(systemImageCompressionItemsTable.jobId, jobId))
    .orderBy(systemImageCompressionItemsTable.id);
  assert.equal(finalItems.length, files.length);
  assert.equal(new Set(finalItems.map(item => item.filename)).size, files.length);
  for (const [index, item] of finalItems.entries()) {
    const bytes = await fs.readFile(path.join(uploadsDir, item.filename));
    const metadata = await sharp(bytes).metadata();
    const actualMime = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
    assert.equal(item.status, "compressed", item.filename);
    assert.equal(item.attempts, 1, `${item.filename} must not be processed twice`);
    assert.equal(item.sourceBytes, originals[index].length, item.filename);
    assert.equal(item.outputBytes, bytes.length, `${item.filename} output size`);
    assert.equal(item.outputMimeType, actualMime, `${item.filename} content type`);
    assert.equal(actualMime, files[index].mime, `${item.filename} format must be preserved`);
    assert.ok(bytes.length < originals[index].length, `${item.filename} should be smaller`);
  }

  await stopApi(restartedApi);
  restartedApi = null;
  await db.delete(systemImageCompressionJobsTable)
    .where(eq(systemImageCompressionJobsTable.id, jobId));
  jobId = undefined;
  await db.$client.end();
  databaseClosed = true;
});
