import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseActivityWeight } from "../artifacts/construction-supervision/src/lib/activity-weight.ts";

test("weight parser preserves four decimal places without rounding", () => {
  for (const value of ["1.2345", "0.0123", "99.9999", "0.0100"]) {
    assert.equal(parseActivityWeight(value), Number(value));
  }
  assert.equal(parseActivityWeight(""), null);
  assert.equal(parseActivityWeight("100.0001"), null);
  assert.equal(parseActivityWeight("0.0099"), null);
});

test("ordinary and managed activity weight fields allow four decimals", () => {
  const source = readFileSync(new URL("../artifacts/construction-supervision/src/pages/projects/[id]/activities.tsx", import.meta.url), "utf8");
  const fields = [...source.matchAll(/name="weight"[\s\S]*?<Input\b([^>]+)>/g)];
  assert.equal(fields.length, 2);
  for (const [, attributes] of fields) {
    assert.match(attributes, /step="0\.0001"/);
    assert.match(attributes, /inputMode="decimal"/);
  }
});
