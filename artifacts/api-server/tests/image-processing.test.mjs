import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createImageProcessor, ImageProcessingError } from "../src/lib/image-processing.ts";
import { sanitizeSvgForRasterization } from "../src/lib/sanitize-svg.ts";
import { IMAGE_PROFILES, IMAGE_POLICY_VERSION, isImageProfile, isReportImageProfile } from "../../../lib/api-zod/src/image-policy.ts";

const require = createRequire(new URL("../package.json", import.meta.url));
const sharp = require("sharp");
const { build } = require("esbuild");
const root = fileURLToPath(new URL("../../../", import.meta.url));
await mkdir(path.join(root, "generated-artifacts"), { recursive: true });
const dir = await mkdtemp(path.join(root, "generated-artifacts/image-processor-test-"));
const workerPath = path.join(dir, "worker.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/image-processing-worker.ts", import.meta.url))],
  outfile: workerPath, bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "native-sharp", setup(build) {
    build.onResolve({ filter: /^sharp$/ }, () => ({ path: require.resolve("sharp"), external: true }));
  } }],
});
after(() => rm(dir, { recursive: true, force: true }));
async function imageFile(name, bytes) {
  const filename = path.join(dir, name);
  await writeFile(filename, bytes);
  return filename;
}
const sourcePath = await imageFile("site.jpg", await sharp({
  create: { width: 2800, height: 1800, channels: 3, background: "#637b91" },
}).jpeg().toBuffer());

test("shared profiles separate reports, thumbnails, logos and attendance", () => {
  assert.equal(IMAGE_POLICY_VERSION, 4);
  assert.equal(IMAGE_PROFILES.report.maxEdge, 1600);
  assert.equal(IMAGE_PROFILES.report.targetMaxBytes, 350 * 1024);
  assert.equal(IMAGE_PROFILES.report_detail.targetMaxBytes, 600 * 1024);
  assert.equal(IMAGE_PROFILES.report_technical.maxOutputBytes, 1536 * 1024);
  assert.equal(IMAGE_PROFILES.thumbnail.maxEdge, 400);
  assert.equal(isImageProfile("__proto__"), false);
  assert.equal(isImageProfile("thumbnail"), true);
  assert.equal(isReportImageProfile("report_detail"), true);
  assert.equal(isReportImageProfile("thumbnail"), false);
  assert.notEqual(IMAGE_PROFILES.attendance.maxEdge, IMAGE_PROFILES.file_image.maxEdge);
});
test("prepared inputs are reused only within verified dimensions and native workers receive no service credentials", async () => {
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#607080" } }).webp().toBuffer();
  const filename = await imageFile("prepared.webp", bytes);
  const processor = createImageProcessor({ workerPath });
  const result = await processor.process({ principal: "prepared", profile: "report", prepared: true, sourcePath: filename });
  assert.equal(result.reused, true);
  assert.equal(result.encodes, 0);
  assert.ok(result.workerBootMs > 0);
  assert.ok(result.workerWallMs >= result.workerBootMs);
  assert.ok(result.workerPeakRss > 0);
  await assert.rejects(processor.process({ principal: "prepared", profile: "report", prepared: true, sourcePath }),
    error => !error.retryable);
  const probe = path.join(dir, "environment-probe.mjs");
  await writeFile(probe, `process.once("message",()=>{const unsafe=Object.keys(process.env).some(key=>/SECRET|TOKEN|API_KEY|DATABASE_URL|BUCKET_ID/.test(key));process.send({ok:false,code:unsafe?"credentials_leaked":"environment_isolated"},()=>process.exit(1));});`);
  await assert.rejects(createImageProcessor({ workerPath: probe }).process({ principal: "probe", profile: "report", sourcePath }),
    error => error.code === "environment_isolated");
});
test("real isolated process rotates, strips metadata, resizes and never enlarges", async () => {
  const oriented = await imageFile("oriented.jpg", await sharp({
    create: { width: 2400, height: 1200, channels: 3, background: "#50637a" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
  const processor = createImageProcessor({ workerPath });
  const result = await processor.process({ principal: "one", profile: "report", sourcePath: oriented });
  assert.equal(result.mimeType, "image/webp");
  assert.equal(result.width, 800);
  assert.equal(result.height, 1600);
  assert.equal(result.policyVersion, IMAGE_POLICY_VERSION);
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  const small = await imageFile("small.jpg", await sharp({ create: {
    width: 120, height: 60, channels: 3, background: "#abcaef",
  } }).jpeg().toBuffer());
  const tiny = await processor.process({ principal: "one", profile: "report", sourcePath: small });
  assert.equal(tiny.width, 120);
  assert.equal(tiny.height, 60);
  assert.equal(tiny.exception, "small_output_below_target");
  assert.deepEqual(processor.getStatus(), { active: 0, pending: 0, principals: 0 });
});
test("detail and technical report profiles preserve the higher output ceilings", async () => {
  const processor = createImageProcessor({ workerPath });
  for (const profile of ["report_detail", "report_technical"]) {
    const result = await processor.process({ principal: profile, profile, sourcePath });
    assert.equal(result.width, 1600);
    assert.equal(result.height, 1029);
    assert.ok(result.byteSize <= IMAGE_PROFILES[profile].maxOutputBytes);
    assert.equal(result.policyVersion, IMAGE_POLICY_VERSION);
  }
});
test("logo transparency survives and attendance has a distinct JPEG profile", async () => {
  const sourcePath = await imageFile("logo.png", await sharp({
    create: { width: 1800, height: 900, channels: 4, background: { r: 30, g: 50, b: 80, alpha: 0.3 } },
  }).png().toBuffer());
  const processor = createImageProcessor({ workerPath });
  const logo = await processor.process({ principal: "one", profile: "logo", sourcePath });
  assert.equal(logo.mimeType, "image/png");
  assert.equal(logo.width, 1000);
  assert.equal((await sharp(logo.buffer).metadata()).hasAlpha, true);
  const attendance = await processor.process({ principal: "one", profile: "attendance", sourcePath });
  assert.equal(attendance.mimeType, "image/jpeg");
  assert.equal(attendance.width, 800);
});
test("corrupt image content fails without accepting partial output", async () => {
  const processor = createImageProcessor({ workerPath });
  const bad = await imageFile("bad.jpg", Buffer.from("not an image"));
  await assert.rejects(processor.process({ principal: "one", profile: "report", sourcePath: bad }),
    error => error instanceof ImageProcessingError && !error.retryable);
  assert.equal(processor.getStatus().active, 0);
});
test("SVG logos are safely rasterized with alpha; active and external content is removed", async () => {
  const source = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120">
    <style>.mark { fill: #e53935; }</style>
    <script>fetch('https://attacker.invalid/')</script>
    <foreignObject><body>unsafe</body></foreignObject>
    <image href="https://attacker.invalid/pixel.png" width="1" height="1"/>
    <rect class="mark" x="0" y="0" width="150" height="120" onclick="alert(1)"/>
  </svg>`);
  const safe = sanitizeSvgForRasterization(source).toString("utf8");
  assert.match(safe, /<svg/);
  assert.match(safe, /#e53935/);
  assert.doesNotMatch(safe, /script|foreignObject|<image|attacker\.invalid|onclick|fetch\(/i);
  const filename = await imageFile("synthetic.svg", source);
  const processor = createImageProcessor({ workerPath });
  const logo = await processor.process({ principal: "svg", profile: "logo", sourcePath: filename });
  assert.equal(logo.mimeType, "image/png");
  assert.equal(logo.width, 300);
  assert.equal(logo.height, 120);
  const pixels = await sharp(logo.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.equal(pixels.data[(60 * 300 + 60) * pixels.info.channels], 229);
  assert.equal(pixels.data[(60 * 300 + 60) * pixels.info.channels + 3], 255);
  assert.equal(pixels.data[(60 * 300 + 240) * pixels.info.channels + 3], 0);
});
test("static GIF logos use the shared raster worker and remain transparent", async () => {
  const bytes = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const filename = await imageFile("synthetic.gif", bytes);
  const processor = createImageProcessor({ workerPath });
  const logo = await processor.process({ principal: "gif", profile: "logo", sourcePath: filename });
  assert.equal(logo.mimeType, "image/png");
  assert.equal(logo.width, 1);
  assert.equal(logo.height, 1);
  assert.equal((await sharp(logo.buffer).metadata()).hasAlpha, true);
});
test("animated GIF input is rejected rather than silently losing frames", async () => {
  const bytes = Buffer.from("R0lGODlhAQABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAgAAA/wAAAAICRAEAOw==", "base64");
  const filename = await imageFile("synthetic-animated.gif", bytes);
  const processor = createImageProcessor({ workerPath });
  await assert.rejects(processor.process({ principal: "animated", profile: "logo", sourcePath: filename }),
    error => error instanceof ImageProcessingError && error.code === "animated_image");
});
test("queued cancellation does not consume worker slots or poison later jobs", async () => {
  const processor = createImageProcessor({ workerPath });
  const controller = new AbortController();
  const first = processor.process({ principal: "one", profile: "report", sourcePath });
  const second = processor.process({ principal: "one", profile: "report", sourcePath, signal: controller.signal });
  const rejected = assert.rejects(second, error => error.code === "cancelled");
  controller.abort();
  await Promise.all([first, rejected]);
  assert.deepEqual(processor.getStatus(), { active: 0, pending: 0, principals: 0 });
});
test("a user cannot take both active workers or monopolize the pending queue", async () => {
  const processor = createImageProcessor({ workerPath });
  const same = Array.from({ length: 4 }, () => processor.process({ principal: "one", profile: "report", sourcePath }));
  const overload = processor.process({ principal: "one", profile: "report", sourcePath });
  await assert.rejects(overload, error => error.code === "processing_busy" && error.retryable);
  const other = processor.process({ principal: "two", profile: "thumbnail", sourcePath });
  assert.equal(processor.getStatus().active, 2);
  await Promise.all([...same, other]);
  assert.equal(processor.getStatus().pending, 0);
});
test("deadline kills only the image worker, then the executor accepts new jobs", async () => {
  const processor = createImageProcessor({ workerPath, timeoutMs: 1 });
  await assert.rejects(processor.process({ principal: "one", profile: "report", sourcePath }),
    error => error.code === "processing_timeout" && error.retryable);
  assert.equal(processor.getStatus().active, 0);
  const live = createImageProcessor({ workerPath });
  assert.equal((await live.process({ principal: "two", profile: "thumbnail", sourcePath })).width, 400);
});
