import assert from "node:assert/strict";
import test from "node:test";
import { generatePublicFormToken } from "../artifacts/api-server/src/lib/public-form-token.ts";

test("public form tokens are URL-safe, long, and independently generated", () => {
  const tokens = Array.from({ length: 100 }, () => generatePublicFormToken());
  assert.ok(tokens.every((token) => /^[A-Za-z0-9_-]{32}$/.test(token)));
  assert.equal(new Set(tokens).size, tokens.length);
});
