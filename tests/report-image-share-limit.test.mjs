import assert from "node:assert/strict";
import test from "node:test";
import {
  REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES,
  REPORT_IMAGE_SHARE_MAX_LIMIT,
  REPORT_IMAGE_MAX_BYTES,
  isJpgReportImageUpload,
  nextReportImageShareUploadCount,
} from "../lib/api-zod/src/report-image-share.ts";

test("the default share limit accepts exactly 20 sequential images", () => {
  let count = 0;
  for (let image = 0; image < REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES; image += 1) {
    count = nextReportImageShareUploadCount(count);
  }
  assert.equal(count, REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES);
  assert.equal(nextReportImageShareUploadCount(count), null);
});

test("concurrent uploads serialized by the share-row lock cannot exceed the default 20", async () => {
  let count = 0;
  let lockTail = Promise.resolve();
  const results = await Promise.all(Array.from({ length: 32 }, async () => {
    let release;
    const previous = lockTail;
    lockTail = new Promise(resolve => { release = resolve; });
    await previous;
    const next = nextReportImageShareUploadCount(count);
    if (next !== null) count = next;
    release();
    return next !== null;
  }));

  assert.equal(results.filter(Boolean).length, REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES);
  assert.equal(count, REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES);
  assert.equal(nextReportImageShareUploadCount(count), null);
});

test("invalid or already exhausted counts are rejected", () => {
  assert.equal(nextReportImageShareUploadCount(REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES), null);
  assert.equal(nextReportImageShareUploadCount(-1), null);
  assert.equal(nextReportImageShareUploadCount(1.5), null);
});

test("each share enforces the image limit selected when it was created", () => {
  const selectedLimit = 75;
  let count = 0;
  for (let index = 0; index < selectedLimit; index += 1) {
    count = nextReportImageShareUploadCount(count, selectedLimit);
  }
  assert.equal(count, selectedLimit);
  assert.equal(nextReportImageShareUploadCount(count, selectedLimit), null);
  assert.equal(nextReportImageShareUploadCount(0, REPORT_IMAGE_SHARE_MAX_LIMIT + 1), null);
});

test("concurrent uploads respect a custom per-share limit", async () => {
  const selectedLimit = 75;
  let count = 0;
  let lockTail = Promise.resolve();
  const results = await Promise.all(Array.from({ length: 100 }, async () => {
    let release;
    const previous = lockTail;
    lockTail = new Promise(resolve => { release = resolve; });
    await previous;
    const next = nextReportImageShareUploadCount(count, selectedLimit);
    if (next !== null) count = next;
    release();
    return next !== null;
  }));
  assert.equal(results.filter(Boolean).length, selectedLimit);
  assert.equal(count, selectedLimit);
  assert.equal(nextReportImageShareUploadCount(count, selectedLimit), null);
});

test("report image uploads require a JPG extension and JPEG media type", () => {
  assert.equal(isJpgReportImageUpload("site-photo.jpg", "image/jpeg"), true);
  assert.equal(isJpgReportImageUpload("SITE-PHOTO.JPG", "image/jpeg"), true);
  assert.equal(isJpgReportImageUpload("site-photo.jpeg", "image/jpeg"), false);
  assert.equal(isJpgReportImageUpload("site-photo.png", "image/png"), false);
  assert.equal(isJpgReportImageUpload("site-photo.jpg", "image/png"), false);
});

test("report image size limit is five mebibytes", () => {
  assert.equal(REPORT_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
});
