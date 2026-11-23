import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/report-preview-loader.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { loadReportPreview, attachProgressiveReportImages } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`,
);

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(assertion, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await tick();
    }
  }
  assertion();
}

test("report metadata is ready without fetching photo assets", async () => {
  const imageCalls = [];
  const result = await loadReportPreview({
    loadReport: async () => ({
      id: 33,
      imageGroups: [{ category: "الموقع", urls: ["/api/uploads/a.jpg", "/api/uploads/b.jpg"] }],
    }),
    loadLogos: async () => ({ owner: { name: "المالك", logoUrl: null } }),
    loadAsset: async url => {
      imageCalls.push(url);
      return `blob:${url}`;
    },
  });

  assert.equal(result.report.id, 33);
  assert.equal(result.imageGroups.length, 1);
  assert.deepEqual(result.imageGroups[0].urls, ["/api/uploads/a.jpg", "/api/uploads/b.jpg"]);
  assert.deepEqual(imageCalls, []);
});

test("photos load on approach, isolate failures, upgrade for print and clean up with the popup", async () => {
  const imageCount = 102;
  const images = Array.from({ length: imageCount }, (_, index) => new FakeImage(index));
  const placeholders = new Map(images.map(image => [
    Number(image.dataset.reportImageIndex),
    { textContent: "", hidden: false, dataset: {}, style: {} },
  ]));
  const observerInstances = [];
  const revoked = [];
  const printButton = new FakeButton();
  const printCalls = [];
  const confirmations = [];
  const document = {
    querySelectorAll: () => images,
    querySelector: selector => placeholders.get(Number(selector.match(/\d+/)?.[0])) ?? null,
    getElementById: id => id === "report-print-button" ? printButton : null,
  };
  const owner = {
    document,
    closed: false,
    URL: { revokeObjectURL: url => revoked.push(url) },
    IntersectionObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnected = false;
        observerInstances.push(this);
      }
      observe(image) { this.observed.push(image); }
      unobserve(image) { this.observed = this.observed.filter(item => item !== image); }
      disconnect() { this.disconnected = true; this.observed = []; }
      reveal(image) { this.callback([{ target: image, isIntersecting: true }]); }
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    print: () => printCalls.push("print"),
    confirm: message => { confirmations.push(message); return true; },
  };
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let activeThumbnails = 0;
  let maxActiveThumbnails = 0;
  const progress = [];
  const cleanup = attachProgressiveReportImages({
    owner,
    imageUrls: Array.from({ length: imageCount }, (_, index) => `/photo/${index}`),
    initialObjectUrls: ["blob:logo"],
    loadAsset: async (url, variant) => {
      calls.push([url, variant]);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (variant === "thumbnail") {
        activeThumbnails += 1;
        maxActiveThumbnails = Math.max(maxActiveThumbnails, activeThumbnails);
      }
      await tick();
      active -= 1;
      if (variant === "thumbnail") activeThumbnails -= 1;
      if (url === "/photo/1") throw new Error("temporary photo failure");
      return `blob:${variant}-${url}`;
    },
    onProgress: value => progress.push(value),
  });

  assert.deepEqual(calls, []);
  const observer = observerInstances[0];
  for (let index = 0; index < 10; index += 1) observer.reveal(images[index]);
  await waitFor(() => assert.equal(calls.filter(([, variant]) => variant === "thumbnail").length, 10));
  await waitFor(() => assert.equal(placeholders.get(1).dataset.state, "error"));
  assert.equal(images[0].src, "blob:thumbnail-/photo/0");
  assert.equal(images[2].src, "blob:thumbnail-/photo/2");

  printButton.click();
  await waitFor(() => assert.equal(printCalls.length, 1));
  assert.ok(calls.some(([url, variant]) => url === "/photo/0" && variant === "photo"));
  assert.ok(calls.some(([url, variant]) => url === "/photo/1" && variant === "photo"));
  assert.ok(calls.some(([url, variant]) => url === "/photo/101" && variant === "photo"));
  assert.equal(calls.filter(([, variant]) => variant === "photo").length, imageCount);
  assert.ok(maxActive <= 2, `photo loader concurrency was ${maxActive}`);
  assert.ok(maxActiveThumbnails <= 1, `thumbnail concurrency was ${maxActiveThumbnails}`);
  assert.equal(progress.at(-1).total, imageCount);
  assert.equal(progress.at(-1).failed, 1);
  assert.equal(confirmations.length, 1);

  cleanup();
  assert.equal(observer.disconnected, true);
  assert.ok(revoked.includes("blob:logo"));
  assert.ok(revoked.includes("blob:thumbnail-/photo/0"));
  assert.ok(revoked.includes("blob:photo-/photo/0"));
});

test("closing the preview aborts an in-flight protected image request", async () => {
  const image = new FakeImage(0);
  let observer;
  let requestSignal;
  const owner = {
    document: {
      querySelectorAll: () => [image],
      querySelector: () => ({ textContent: "", hidden: false, dataset: {}, style: {} }),
      getElementById: () => null,
    },
    closed: false,
    URL: { revokeObjectURL() {} },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const cleanup = attachProgressiveReportImages({
    owner,
    imageUrls: ["/slow-photo"],
    loadAsset: (_url, _variant, signal) => new Promise((_resolve, reject) => {
      requestSignal = signal;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    onProgress() {},
  });

  observer.callback([{ target: image, isIntersecting: true }]);
  await waitFor(() => assert.ok(requestSignal));
  cleanup();
  assert.equal(requestSignal.aborted, true);
});

test("printing cancels queued screen thumbnails before requesting print copies", async () => {
  const imageCount = 12;
  const images = Array.from({ length: imageCount }, (_, index) => new FakeImage(index));
  const placeholders = new Map(images.map(image => [
    Number(image.dataset.reportImageIndex),
    { textContent: "", hidden: false, dataset: {}, style: {} },
  ]));
  let observer;
  const printButton = new FakeButton();
  let printCount = 0;
  let thumbnailRequests = 0;
  let printRequests = 0;
  const owner = {
    document: {
      querySelectorAll: () => images,
      querySelector: selector => placeholders.get(Number(selector.match(/\d+/)?.[0])) ?? null,
      getElementById: id => id === "report-print-button" ? printButton : null,
    },
    closed: false,
    URL: { revokeObjectURL() {} },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    print() { printCount += 1; },
  };
  const cleanup = attachProgressiveReportImages({
    owner,
    imageUrls: Array.from({ length: imageCount }, (_, index) => `/print/${index}`),
    loadAsset: (url, variant, signal) => {
      if (variant === "photo") {
        printRequests += 1;
        return Promise.resolve(`blob:print-${url}`);
      }
      thumbnailRequests += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("thumbnail cancelled")), { once: true });
      });
    },
    onProgress() {},
  });

  for (let index = 0; index < 8; index += 1) {
    observer.callback([{ target: images[index], isIntersecting: true }]);
  }
  await waitFor(() => assert.equal(thumbnailRequests, 1));
  printButton.click();
  await waitFor(() => assert.equal(printCount, 1));

  assert.equal(thumbnailRequests, 1);
  assert.equal(printRequests, imageCount);
  cleanup();
});

class FakeImage {
  constructor(index) {
    this.dataset = { reportImageIndex: String(index) };
    this.listeners = new Map();
    this.complete = false;
    this.naturalWidth = 0;
    this.currentSrc = "";
  }
  addEventListener(name, callback) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(callback);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name, callback) {
    this.listeners.get(name)?.delete(callback);
  }
  set src(value) {
    this.currentSrc = value;
    this.complete = true;
    this.naturalWidth = 1;
    queueMicrotask(() => {
      for (const listener of this.listeners.get("load") ?? []) listener();
    });
  }
  get src() { return this.currentSrc; }
}

class FakeButton {
  constructor() {
    this.listeners = new Set();
    this.disabled = false;
    this.textContent = "طباعة";
  }
  addEventListener(name, callback) {
    if (name === "click") this.listeners.add(callback);
  }
  removeEventListener(name, callback) {
    if (name === "click") this.listeners.delete(callback);
  }
  click() {
    const event = { preventDefault() {} };
    for (const listener of this.listeners) listener(event);
  }
}
