import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceEventTime } from "../artifacts/api-server/src/lib/attendance-event-time.ts";

test("offline event time is retained while server receive time remains separate", () => {
  const now = Date.parse("2026-11-21T10:00:00.000Z");
  const capturedAt = now - 45 * 60_000;
  const result = parseAttendanceEventTime(capturedAt, now);
  assert.equal(result.ok, true);
  assert.equal(result.recordedAt?.getTime(), capturedAt);
});

test("legacy clients without capturedAt keep the database server-time default", () => {
  assert.deepEqual(parseAttendanceEventTime(undefined, 1234), { ok: true });
});

test("invalid and excessively future event times are rejected", () => {
  const now = Date.parse("2026-11-21T10:00:00.000Z");
  assert.deepEqual(parseAttendanceEventTime("1234", now), { ok: false });
  assert.deepEqual(parseAttendanceEventTime(Number.NaN, now), { ok: false });
  assert.deepEqual(parseAttendanceEventTime(now + 6 * 60_000, now), { ok: false });
});
