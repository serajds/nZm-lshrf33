import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

test("report progress history works without PostgreSQL triggers", { timeout: 120_000 }, async () => {
  delete process.env.SOURCE_PRODUCTION_DATABASE_URL;
  const previousJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-report-history-secret";
  process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/not-used";
  const postgres = await isolatedPostgres();
  let server;
  let dbModule;
  try {
    // The schema push creates the history table but intentionally does not run
    // migration 0008's custom trigger/function SQL.
    dbModule = await import("../lib/db/src/index.ts");
    const triggerCheck = await dbModule.pool.query(
      "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%history%'",
    );
    assert.equal(triggerCheck.rows.length, 0, "isolated database has no history triggers");

    const [{ default: app }, { signToken }, schema, { eq }] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
      import("../lib/db/src/index.ts"),
      import("../lib/db/node_modules/drizzle-orm/index.js"),
    ]);
    const { db, usersTable, projectsTable, activitiesTable, projectProgressHistoryTable } = schema;
    const [user] = await db.insert(usersTable).values({
      phone: `report-history-test-${Date.now()}`,
      passwordHash: "unused",
      fullName: "Temporary report history test",
      role: "admin",
    }).returning();
    const [project] = await db.insert(projectsTable).values({
      name: "App-side progress history test",
      location: "test fixture",
      ownerEntity: "test fixture",
      supervisorEntity: "test fixture",
      contractor: "test fixture",
      startDate: "2026-01-01",
      expectedEndDate: "2026-12-31",
    }).returning();
    const [activity] = await db.insert(activitiesTable).values({
      projectId: project.id,
      name: "Historical percentage fixture",
      plannedStartDate: "2026-01-01",
      plannedEndDate: "2026-12-31",
      actualProgress: 35,
      plannedProgress: 35,
      weight: 2,
      status: "in_progress",
      sortOrder: 1,
    }).returning();
    assert.equal((await db.select().from(projectProgressHistoryTable)).length, 0);

    server = createServer(app).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const token = signToken({ userId: user.id, phone: user.phone, role: user.role });
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const todayParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const part = type => todayParts.find(item => item.type === type).value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;

    const readProgress = async () => {
      const response = await fetch(`${base}/projects/${project.id}/reports/progress-as-of?periodEnd=${today}`, { headers });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload;
    };
    const initial = await readProgress();
    assert.equal(initial.available, true, "today-only baseline is recorded for an existing project");
    assert.equal(initial.overallProgress, 35);

    const updateResponse = await fetch(`${base}/projects/${project.id}/activities/${activity.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ actualProgress: 70, status: "in_progress" }),
    });
    assert.equal(updateResponse.status, 200, await updateResponse.text());
    const updated = await readProgress();
    assert.equal(updated.overallProgress, 70, "API activity changes create a new history snapshot");
    assert.ok(updated.capturedAt, "updated progress has a recorded capture time");
    assert.equal((await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, project.id))).length, 2);

    const reportResponse = await fetch(`${base}/projects/${project.id}/reports`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "period",
        reportDate: today,
        periodStart: today,
        periodEnd: today,
        workDescription: "Temporary test report.",
        progressSource: "history",
        historyFingerprint: updated.fingerprint,
      }),
    });
    const report = await reportResponse.json();
    assert.equal(reportResponse.status, 201, JSON.stringify(report));
    assert.equal(report.progressPercentage, 70);
    assert.equal(report.progressSource, "history");
    assert.equal(report.progressAsOfDate, today);
  } finally {
    if (server) await new Promise(resolvePromise => server.close(resolvePromise));
    if (dbModule?.pool) await dbModule.pool.end();
    await postgres.stop();
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  }
});
