import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import sharp from "sharp";
import {
  REPORT_IMAGE_MAX_PIXELS,
  appendReportShareImage,
  isAllowedReportImageDimensions,
  nextReportImageShareUploadCount,
} from "@workspace/api-zod";
import { createReportShareUploadAdmission } from "../src/lib/report-share-upload-admission.ts";
import { tryAcquireReportShareUploadLock } from "../src/lib/report-share-upload-lock.ts";
import {
  ReportShareImageValidationError,
  validateReportShareImageBuffer,
} from "../src/lib/report-share-image-validation.ts";

test("report image dimensions stay within the shared processing limit", () => {
  assert.equal(REPORT_IMAGE_MAX_PIXELS, 40_000_000);
  assert.equal(isAllowedReportImageDimensions(8000, 5000), true);
  assert.equal(isAllowedReportImageDimensions(8001, 5000), false);
  assert.equal(isAllowedReportImageDimensions(0, 10), false);
  assert.equal(isAllowedReportImageDimensions(Number.MAX_SAFE_INTEGER, 2), false);
});

test("validates image bytes and rejects malformed uploads explicitly", async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 3, channels: 3, background: { r: 20, g: 80, b: 140 } },
  }).jpeg().toBuffer();

  assert.deepEqual(await validateReportShareImageBuffer(jpeg, "site.jpg", "image/jpeg"), {
    width: 2,
    height: 3,
  });
  await assert.rejects(
    validateReportShareImageBuffer(jpeg, "site.png", "image/png"),
    error => error instanceof ReportShareImageValidationError && error.statusCode === 400,
  );
  await assert.rejects(
    validateReportShareImageBuffer(Buffer.from("not an image"), "site.jpg", "image/jpeg"),
    error => error instanceof ReportShareImageValidationError && error.statusCode === 400,
  );
});

test("a share upload keeps existing group image references and only appends to its target", () => {
  const before = [
    { id: "a", category: "الموقع", urls: ["/old-1.jpg"], note: "keep" },
    { id: "b", category: "الأعمال", urls: ["/old-2.jpg"] },
  ];
  const result = appendReportShareImage(before, "a", "/new.jpg", ["/legacy-reference.jpg"]);
  assert.deepEqual(result?.groups[0], {
    id: "a", category: "الموقع", urls: ["/old-1.jpg", "/new.jpg"], note: "keep",
  });
  assert.deepEqual(result?.imageUrls, [
    "/legacy-reference.jpg", "/old-1.jpg", "/new.jpg", "/old-2.jpg",
  ]);
  assert.deepEqual(before[0].urls, ["/old-1.jpg"], "the source snapshot remains unchanged");
  assert.equal(appendReportShareImage(before, "missing", "/ignored.jpg"), null);
});

test("the per-link counter stops exactly at its configured maximum", () => {
  assert.equal(nextReportImageShareUploadCount(0, 2), 1);
  assert.equal(nextReportImageShareUploadCount(1, 2), 2);
  assert.equal(nextReportImageShareUploadCount(2, 2), null);
});

test("local admission rejects a concurrent body before parsing and releases on response", () => {
  class FakeRequest extends EventEmitter {
    method = "POST";
    originalUrl = "/api/public/report-image-shares/upload";
  }
  class FakeResponse extends EventEmitter {
    statusCode = 200;
    headers = {};
    body;
    setHeader(name, value) { this.headers[name] = value; return this; }
    status(code) { this.statusCode = code; return this; }
    json(body) { this.body = body; return this; }
  }

  const gate = createReportShareUploadAdmission();
  const firstReq = new FakeRequest();
  const firstRes = new FakeResponse();
  let firstNext = 0;
  gate(firstReq, firstRes, () => firstNext++);
  assert.equal(firstNext, 1);

  const blockedRes = new FakeResponse();
  let blockedNext = 0;
  gate(new FakeRequest(), blockedRes, () => blockedNext++);
  assert.equal(blockedNext, 0);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.headers["Retry-After"], "2");

  firstRes.emit("finish");
  const nextRes = new FakeResponse();
  let nextCalled = false;
  gate(new FakeRequest(), nextRes, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  nextRes.emit("close");
});

test("PostgreSQL upload lock serializes instances and releases after failure", {
  skip: process.env.REPORT_SHARE_UPLOAD_LOCK_TESTS !== "1",
  timeout: 15_000,
}, async t => {
  const { db, pool } = await import("@workspace/db");
  t.after(() => pool.end());
  let signalFirst;
  let releaseFirst;
  const firstEntered = new Promise(resolve => { signalFirst = resolve; });
  const firstHold = new Promise(resolve => { releaseFirst = resolve; });
  const firstTransaction = db.transaction(async tx => {
    assert.equal(await tryAcquireReportShareUploadLock(query => tx.execute(query)), true);
    signalFirst();
    await firstHold;
  });

  try {
    await firstEntered;
    const parallelAttempt = await db.transaction(tx =>
      tryAcquireReportShareUploadLock(query => tx.execute(query)));
    assert.equal(parallelAttempt, false);
  } finally {
    releaseFirst();
  }
  await firstTransaction;

  const afterCommit = await db.transaction(tx =>
    tryAcquireReportShareUploadLock(query => tx.execute(query)));
  assert.equal(afterCommit, true);

  await assert.rejects(db.transaction(async tx => {
    assert.equal(await tryAcquireReportShareUploadLock(query => tx.execute(query)), true);
    throw new Error("simulated image-processing failure");
  }), /simulated image-processing failure/);
  const afterRollback = await db.transaction(tx =>
    tryAcquireReportShareUploadLock(query => tx.execute(query)));
  assert.equal(afterRollback, true);
});
