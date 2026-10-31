import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../construction-supervision/src/lib/dev-runtime-context.js", import.meta.url), "utf8");
function install() {
  const window = new EventTarget();
  window.location = { href: "https://development.example/" };
  const logs = [];
  class ErrorEvent extends Event {
    constructor(type, props = {}) { super(type); Object.assign(this, props); }
  }
  class HTMLElement {}
  vm.runInNewContext(source, {
    window, URL, Error, ErrorEvent, HTMLElement,
    console: { error: (...args) => logs.push(args) },
  });
  return { window, ErrorEvent, logs };
}

test("missing Error metadata reaches the overlay as the actual message and source", () => {
  const { window, ErrorEvent } = install();
  let received;
  window.addEventListener("error", event => { received = event.error; });
  const event = new ErrorEvent("error", {
    message: "Synthetic module failure", error: null,
    filename: "https://development.example/src/sample.tsx?token=synthetic-secret", lineno: 42, colno: 9,
  });
  window.dispatchEvent(event);
  assert.ok(received instanceof Error);
  assert.equal(received.message, "Synthetic module failure");
  assert.match(received.stack, /sample\.tsx:42:9/);
  assert.doesNotMatch(received.stack, /synthetic-secret|unknown runtime/);
  assert.equal(event.defaultPrevented, false);
});

test("native Errors and their stack remain untouched", () => {
  const { window, ErrorEvent, logs } = install();
  const error = new Error("Native error");
  const stack = error.stack;
  const event = new ErrorEvent("error", { error });
  window.dispatchEvent(event);
  assert.equal(event.error, error);
  assert.equal(event.error.stack, stack);
  assert.deepEqual(logs, []);
});

test("string promise rejection is useful and redacts credentials, query strings and scoped links", () => {
  const { window, logs } = install();
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", {
    configurable: true,
    value: "Synthetic rejection Bearer synthetic-bearer https://development.example/owner/scoped-token?token=synthetic-query password=synthetic-password",
  });
  window.dispatchEvent(event);
  assert.ok(event.reason instanceof Error);
  assert.match(event.reason.message, /Synthetic rejection/);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-bearer|scoped-token|synthetic-query|synthetic-password/);
  assert.equal(event.defaultPrevented, false);
});

test("object or absent rejection reasons never stringify private object fields", () => {
  const { window, logs } = install();
  for (const reason of [undefined, { message: "Synthetic object rejection", password: "private-field" },
    new Proxy({}, { get() { throw new Error("getter must not escape"); } })]) {
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { configurable: true, value: reason });
    window.dispatchEvent(event);
    assert.ok(event.reason instanceof Error);
  }
  assert.doesNotMatch(JSON.stringify(logs), /private-field|getter must not escape/);
});

test("JSON-shaped string rejections redact quoted credential fields too", () => {
  const { window, logs } = install();
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { configurable: true,
    value: '{"token":"synthetic-json-token","password":"synthetic-json-password"}' });
  window.dispatchEvent(event);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-json-token|synthetic-json-password/);
});

test("diagnostic injection is development-only and does not disable the existing overlay", () => {
  const config = readFileSync(new URL("../../construction-supervision/vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /name: "development-runtime-error-context",\s*apply: "serve"/);
  assert.match(config, /runtimeErrorOverlay\(\)/);
  assert.doesNotMatch(source, /stopImmediatePropagation|stopPropagation|preventDefault/);
});
