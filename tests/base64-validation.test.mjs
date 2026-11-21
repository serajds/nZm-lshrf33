import assert from "node:assert/strict";
import test from "node:test";
import { isValidBase64String } from "../artifacts/api-server/src/lib/base64-validation.ts";

test("accepts valid padded Base64 and rejects misplaced or excessive padding", () => {
  for (const value of ["AAAA", "AAA=", "AA==", "YWJjZA=="]) {
    assert.equal(isValidBase64String(value), true, value);
  }
  for (const value of ["", "A", "A===", "AA=A", "====", "AA==!", "éAAA"]) {
    assert.equal(isValidBase64String(value), false, value);
  }
});

test("legacy Excel import still accepts omitted padding", () => {
  assert.equal(isValidBase64String("YWJjZA", { allowUnpadded: true }), true);
  assert.equal(isValidBase64String("YWJjZA", { allowUnpadded: false }), false);
  assert.equal(isValidBase64String("AAAA=", { allowUnpadded: true }), true);
});

test("large upload payloads are checked safely in one bounded linear pass", () => {
  const maximumSizedPayload = "A".repeat(20_971_520);
  assert.equal(isValidBase64String(maximumSizedPayload), true);
  assert.equal(isValidBase64String(`${maximumSizedPayload.slice(0, -1)}!`), false);
});
