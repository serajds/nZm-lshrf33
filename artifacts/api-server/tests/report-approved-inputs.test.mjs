import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/report-approved-inputs.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { approvedReportFingerprint, validApprovedProgress, buildApprovedReportPrompt } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("approved progress accepts explicit zero, rejects missing, coerced and invalid percentages", () => {
  for (const value of [0, 40, 23.8, 100]) assert.equal(validApprovedProgress(value), true);
  for (const value of [undefined, null, "", "40", -1, 101, NaN, Infinity]) assert.equal(validApprovedProgress(value), false);
});
test("draft fingerprint binds the approved percentage and all reporting dates", () => {
  const args = ["2026-10-25", "2026-09-01", "2026-09-30", 40];
  const original = approvedReportFingerprint(...args);
  assert.match(original, /^approved:[a-f0-9]{64}$/);
  assert.equal(original, approvedReportFingerprint(...args));
  for (let i = 0; i < args.length; i++) {
    const changed = [...args];
    changed[i] = i === 3 ? 60 : "2026-10-01";
    assert.notEqual(original, approvedReportFingerprint(...changed));
  }
});
test("AI input includes approved report facts only, not current activities or image labels", () => {
  const input = {
    reportDate: "2026-10-25", periodStart: "2026-09-01", periodEnd: "2026-09-30",
    progressPercentage: 40, workDescription: "صب سقف الدور الثاني",
  };
  const prompt = buildApprovedReportPrompt(input);
  assert.ok(prompt.includes(JSON.stringify(input)));
  assert.ok(prompt.includes("المصدر الوحيد"));
  assert.ok(prompt.includes("لا توزع النسبة الإجمالية"));
  assert.ok(prompt.includes("لا تحسب SPI"));
});
