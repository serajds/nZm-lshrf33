import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../artifacts/construction-supervision/package.json", import.meta.url));
const { build } = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("esbuild");
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement } = require("react");
const compiled = await build({
  entryPoints: ["artifacts/construction-supervision/src/components/deviation/executive-summary.tsx"],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
});
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, module, module.exports);
const data = {
  status: "ahead", scheduleStatus: "available", dataStatus: "live", progressDeviation: 10,
  actualProgress: 60, plannedProgress: 50, spi: 1.21, asOfDate: "2026-11-03",
  forecastStatus: "estimated", forecastCompletionDate: "2028-04-16",
  forecastDelayDays: -75, expectedProgressAtEnd: 100, currentEndDate: "2028-06-30",
  timeDeviation: 10, overrunDays: 0, grossDelayDays: 0, netDelayDays: null,
};
function render(patch = {}) {
  return renderToStaticMarkup(createElement(module.exports.ExecutiveSummary, { data: { ...data, ...patch } }));
}
test("early completion displays an explicit early message instead of negative delay", () => {
  const html = render();
  assert.match(html, /أبكر من الموعد بـ75 يومًا/);
  assert.doesNotMatch(html, /-75|التأخر المتوقع عن النهاية الحالية/);
  assert.match(html, /موعد النهاية المجدول الحالي/);
  assert.match(html, /موعد الإكمال التقديري/);
  assert.match(html, /وليس ضمانًا/);
  assert.match(html, /dir="rtl"/);
});
test("late completion and on-time completion have unambiguous wording", () => {
  assert.match(render({ forecastDelayDays: 12 }), /متأخر عن الموعد بـ12 يومًا/);
  assert.match(render({ forecastDelayDays: 0 }), /في الموعد المجدول/);
});
test("unknown or inapplicable forecasts never imply on-time or early completion", () => {
  for (const patch of [
    { forecastDelayDays: null }, { forecastDelayDays: NaN },
    { forecastDelayDays: Infinity }, { forecastStatus: "not_started" },
    { forecastStatus: "completed_without_date" }, { forecastStatus: "unavailable" },
  ]) {
    assert.doesNotMatch(render(patch), /أبكر من الموعد|متأخر عن الموعد|في الموعد المجدول/);
  }
});
