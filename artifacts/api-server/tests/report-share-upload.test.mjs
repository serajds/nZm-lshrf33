import assert from "node:assert/strict";
import test from "node:test";
import {
  REPORT_IMAGE_MAX_PIXELS,
  isAllowedReportImageDimensions,
  nextReportImageShareUploadCount,
} from "@workspace/api-zod";
import { tryAcquireReportShareUploadLock } from "../src/lib/report-share-upload-lock.ts";

test("report image dimensions stay within the shared processing limit", () => {
  assert.equal(REPORT_IMAGE_MAX_PIXELS, 40_000_000);
  assert.equal(isAllowedReportImageDimensions(8000, 5000), true);
  assert.equal(isAllowedReportImageDimensions(8001, 5000), false);
  assert.equal(isAllowedReportImageDimensions(0, 10), false);
  assert.equal(isAllowedReportImageDimensions(Number.MAX_SAFE_INTEGER, 2), false);
});

test("the per-link counter stops exactly at its configured maximum", () => {
  assert.equal(nextReportImageShareUploadCount(0, 2), 1);
  assert.equal(nextReportImageShareUploadCount(1, 2), 2);
  assert.equal(nextReportImageShareUploadCount(2, 2), null);
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
