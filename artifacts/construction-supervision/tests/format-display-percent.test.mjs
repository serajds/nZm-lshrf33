import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplayPercent } from "../src/lib/format-display-percent.ts";

test("percent labels round only for display and remove trailing zeroes", () => {
  const preciseActual = 10.769230769230769;
  const precisePlanned = 40.430769230769236;
  const preciseDeviation = preciseActual - precisePlanned;

  assert.equal(formatDisplayPercent(preciseActual), "10.8%");
  assert.equal(formatDisplayPercent(precisePlanned), "40.4%");
  assert.equal(formatDisplayPercent(preciseDeviation, true), "-29.7%");
  assert.equal(formatDisplayPercent(50), "50%");
  assert.equal(formatDisplayPercent(1.05, true), "+1.1%");
  assert.equal(formatDisplayPercent(-0.001, true), "0%");
  assert.equal(preciseActual, 10.769230769230769);
  assert.equal(precisePlanned, 40.430769230769236);
  assert.equal(preciseDeviation, preciseActual - precisePlanned);
});