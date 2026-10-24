import assert from "node:assert/strict";
import test from "node:test";
import { parseActivityWeight } from "../src/lib/activity-weight.ts";

test("activity weight accepts the existing bounds and decimal weights", () => {
  for (const [input, expected] of [["0.01", 0.01], ["1", 1], ["2.5", 2.5], ["100", 100], [" 7 ", 7]]) {
    assert.equal(parseActivityWeight(input), expected);
  }
});

test("activity weight rejects missing, nonfinite, zero and out-of-range values", () => {
  for (const input of ["", " ", "0", "-1", "0.001", "100.1", "NaN", "Infinity", "abc"]) {
    assert.equal(parseActivityWeight(input), null);
  }
});
