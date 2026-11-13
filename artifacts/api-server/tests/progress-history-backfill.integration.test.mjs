import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isolatedPostgres } from "../../../tests/helpers/isolated-postgres.mjs";

test("historical backfill is previewed, atomic, idempotent, reportable and reversible", {
  timeout: 120_000,
}, async () => {
  delete process.env.SOURCE_PRODUCTION_DATABASE_URL;
  const previousJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-backfill-secret";
  process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/not-used";
  const postgres = await isolatedPostgres();
  let server;
  let schema;
  try {
    const [{ default: app }, { signToken }, dbSchema, { eq }] = await Promise.all([
      import("../src/app.ts"),
      import("../src/lib/auth.ts"),
      import("../../../lib/db/src/index.ts"),
      import("../../../lib/db/node_modules/drizzle-orm/index.js"),
    ]);
    schema = dbSchema;
    const {
      db, pool, usersTable, companiesTable, userCompaniesTable, projectsTable, activitiesTable, activityGroupsTable,
      projectMembersTable, projectProgressHistoryTable, projectProgressHistoryBatchesTable, reportsTable,
    } = dbSchema;
    for (const migration of [
      "../../../lib/db/migrations/0011_estimated_project_progress_history.sql",
      "../../../lib/db/migrations/0012_report_period_start_progress.sql",
      "../../../lib/db/migrations/0013_report_history_provenance.sql",
    ]) {
      await pool.query(await readFile(new URL(migration, import.meta.url), "utf8"));
    }
    const [admin] = await db.insert(usersTable).values({
      phone: `backfill-admin-${Date.now()}`, passwordHash: "unused",
      fullName: "Temporary backfill admin", role: "admin",
    }).returning();
    const [engineer] = await db.insert(usersTable).values({
      phone: `backfill-engineer-${Date.now()}`, passwordHash: "unused",
      fullName: "Temporary engineer", role: "engineer",
    }).returning();
    const [manager] = await db.insert(usersTable).values({
      phone: `backfill-manager-${Date.now()}`, passwordHash: "unused",
      fullName: "Temporary project manager", role: "project_manager",
    }).returning();
    const [managerCompany] = await db.insert(companiesTable).values({
      name: "Backfill manager fixture", type: "supervisor",
    }).returning();
    await db.insert(userCompaniesTable).values({
      userId: manager.id, companyId: managerCompany.id,
    });
    const [project] = await db.insert(projectsTable).values({
      name: "Safe historical fixture", location: "fixture", ownerEntity: "fixture",
      supervisorEntity: "fixture", contractor: "fixture", startDate: "2026-01-01",
      expectedEndDate: "2026-12-31",
    }).returning();
    const [sourceProject] = await db.insert(projectsTable).values({
      name: "Linked source fixture", location: "fixture", ownerEntity: "fixture",
      supervisorEntity: "fixture", contractor: "fixture", startDate: "2026-01-01",
      expectedEndDate: "2026-12-31",
    }).returning();
    const [sourceGroup] = await db.insert(activityGroupsTable).values({
      projectId: sourceProject.id, name: "Source group",
    }).returning();
    const [complete] = await db.insert(activitiesTable).values({
      projectId: project.id, name: "Completed activity", status: "completed",
      plannedStartDate: "2026-01-01", plannedEndDate: "2026-03-01",
      actualStartDate: "2026-01-01", actualEndDate: "2026-03-01",
      actualProgress: 100, weight: 1,
    }).returning();
    const [active] = await db.insert(activitiesTable).values({
      projectId: project.id, name: "Ongoing activity", status: "in_progress",
      plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31",
      actualStartDate: "2026-02-01", actualProgress: 40, weight: 2,
    }).returning();
    const [notStarted] = await db.insert(activitiesTable).values({
      projectId: project.id, name: "Not started activity", status: "not_started",
      plannedStartDate: "2026-05-01", plannedEndDate: "2026-10-01",
      actualProgress: 0, weight: 1,
    }).returning();
    const [linked] = await db.insert(activitiesTable).values({
      projectId: project.id, name: "Linked source activity", status: "in_progress",
      actualProgress: 30, weight: 1, externalSourceGroupId: sourceGroup.id,
    }).returning();
    await db.insert(activitiesTable).values({
      projectId: sourceProject.id, name: "Source child", groupId: sourceGroup.id,
      status: "in_progress", actualProgress: 30, weight: 1,
    });
    await db.insert(projectMembersTable).values({
      projectId: project.id, userId: engineer.id, role: "engineer",
    });
    await db.insert(projectMembersTable).values({
      projectId: project.id, userId: manager.id, role: "project_manager",
    });

    const historicalSnapshot = (projectId, rows, groups = []) => ({
      projectId, noSchedule: false, startDate: "2026-01-01", expectedEndDate: "2026-12-31",
      activities: rows, groups,
    });
    const dated = (day, time = "10:00:00Z") => new Date(`${day}T${time}`);
    const sourceChild = { id: 0, name: "Source child", groupId: sourceGroup.id, actualProgress: 10,
      plannedProgress: 10, weight: 1, status: "in_progress", sortOrder: 0, externalSourceGroupId: null,
      plannedStartDate: null, plannedEndDate: null, actualStartDate: null, actualEndDate: null };
    await db.insert(projectProgressHistoryTable).values([
      {
        projectId: sourceProject.id, capturedAt: dated("2026-01-01"),
        snapshot: historicalSnapshot(sourceProject.id, [sourceChild], [{ id: sourceGroup.id, name: "Source group" }]),
      },
      {
        projectId: sourceProject.id, capturedAt: dated("2026-04-01"),
        snapshot: historicalSnapshot(sourceProject.id, [{ ...sourceChild, actualProgress: 30 }], [{ id: sourceGroup.id, name: "Source group" }]),
      },
      {
        projectId: project.id, capturedAt: dated("2026-02-15"),
        snapshot: historicalSnapshot(project.id, [
          { id: complete.id, name: complete.name, actualProgress: 60, plannedProgress: 20, weight: 1, status: "in_progress", groupId: null, externalSourceGroupId: null },
          { id: active.id, name: active.name, actualProgress: 15, plannedProgress: 15, weight: 2, status: "in_progress", groupId: null, externalSourceGroupId: null },
          { id: notStarted.id, name: notStarted.name, actualProgress: 0, plannedProgress: 0, weight: 1, status: "not_started", groupId: null, externalSourceGroupId: null },
          { id: linked.id, name: linked.name, actualProgress: 10, plannedProgress: 10, weight: 1, status: "in_progress", groupId: null, externalSourceGroupId: sourceGroup.id },
        ]),
      },
    ]);
    await db.insert(reportsTable).values({
      projectId: project.id, reportNumber: 1, type: "period", reportDate: "2026-02-01",
      periodStart: "2026-01-01", periodEnd: "2026-01-31",
      workDescription: "Historical verified report", progressPercentage: 10,
      progressSource: "history", progressAsOfDate: "2026-01-31",
      activitiesSnapshot: [
        { id: complete.id, actualProgress: 40, weight: 1, actualHistoricalUnverified: false },
        { id: active.id, actualProgress: 0, weight: 2, actualHistoricalUnverified: false },
        { id: notStarted.id, actualProgress: 0, weight: 1, actualHistoricalUnverified: false },
        { id: linked.id, actualProgress: 10, weight: 1, actualHistoricalUnverified: false },
      ],
    });
    const originalActivityValues = await db.select({
      id: activitiesTable.id, actualProgress: activitiesTable.actualProgress,
      status: activitiesTable.status,
    }).from(activitiesTable).where(eq(activitiesTable.projectId, project.id));
    const originalHistory = await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, project.id));
    const sourceHistoryRows = await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, sourceProject.id));
    const latestSourceHistory = sourceHistoryRows.find(row =>
      row.capturedAt.toISOString() === "2026-04-01T10:00:00.000Z");
    assert.ok(latestSourceHistory, "the linked source has a dated history fixture");
    const originalLatestSourceSnapshot = structuredClone(latestSourceHistory.snapshot);

    server = createServer(app).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const headers = token => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
    const adminToken = signToken({ userId: admin.id, phone: admin.phone, role: admin.role });
    const engineerToken = signToken({ userId: engineer.id, phone: engineer.phone, role: engineer.role });
    const managerToken = signToken({ userId: manager.id, phone: manager.phone, role: manager.role });
    const input = {
      periodStart: "2026-01-01", realityDate: "2026-04-01", realityProgress: 42,
      activityInputs: [{ activityId: active.id, startDate: "2026-02-01" }],
      referencePoints: [{ date: "2026-02-15", progress: 20 }],
    };
    const denied = await fetch(`${base}/projects/${project.id}/progress-history-backfill/preview`, {
      method: "POST", headers: headers(engineerToken), body: JSON.stringify(input),
    });
    assert.equal(denied.status, 403, "ordinary engineers cannot preview or import");
    const managerState = await fetch(`${base}/projects/${project.id}/progress-history-backfill`, {
      headers: headers(managerToken),
    });
    assert.equal(managerState.status, 200, `the assigned project manager can open the tool: ${await managerState.text()}`);

    const previewResponse = await fetch(`${base}/projects/${project.id}/progress-history-backfill/preview`, {
      method: "POST", headers: headers(adminToken), body: JSON.stringify(input),
    });
    const preview = await previewResponse.json();
    assert.equal(previewResponse.status, 200, JSON.stringify(preview));
    assert.equal(preview.valid, true);
    assert.equal(preview.snapshotsToSkip, 1, "the actual Feb 15 snapshot remains authoritative");
    assert.equal(preview.unavailableActivities, 0, "the linked source has dated history");

    const changedSourceSnapshot = structuredClone(originalLatestSourceSnapshot);
    changedSourceSnapshot.activities[0].actualProgress = 35;
    await db.update(projectProgressHistoryTable).set({ snapshot: changedSourceSnapshot })
      .where(eq(projectProgressHistoryTable.id, latestSourceHistory.id));
    const staleSourceCommit = await fetch(`${base}/projects/${project.id}/progress-history-backfill/commit`, {
      method: "POST", headers: headers(adminToken),
      body: JSON.stringify({ input, previewToken: preview.previewToken }),
    });
    assert.equal(staleSourceCommit.status, 409, "a linked source history change invalidates the preview");
    await db.update(projectProgressHistoryTable).set({ snapshot: originalLatestSourceSnapshot })
      .where(eq(projectProgressHistoryTable.id, latestSourceHistory.id));

    await db.update(activitiesTable).set({ name: "Changed after preview" }).where(eq(activitiesTable.id, active.id));
    const staleBeforeCommit = await fetch(`${base}/projects/${project.id}/progress-history-backfill/commit`, {
      method: "POST", headers: headers(adminToken),
      body: JSON.stringify({ input, previewToken: preview.previewToken }),
    });
    assert.equal(staleBeforeCommit.status, 409, "changed project data invalidates the preview");
    await db.update(activitiesTable).set({ name: active.name }).where(eq(activitiesTable.id, active.id));
    const currentPreviewResponse = await fetch(`${base}/projects/${project.id}/progress-history-backfill/preview`, {
      method: "POST", headers: headers(adminToken), body: JSON.stringify(input),
    });
    const currentPreview = await currentPreviewResponse.json();

    const commit = async () => fetch(`${base}/projects/${project.id}/progress-history-backfill/commit`, {
      method: "POST", headers: headers(adminToken),
      body: JSON.stringify({ input, previewToken: currentPreview.previewToken }),
    });
    const concurrent = await Promise.all([commit(), commit()]);
    const createdResponse = concurrent.find(response => response.status === 201);
    const blockedResponse = concurrent.find(response => response.status === 409);
    assert.ok(createdResponse && blockedResponse, "concurrent submissions create one batch only");
    const created = await createdResponse.json();
    assert.ok(created.inserted > 0);
    assert.equal(created.skippedActual, 1);
    const batchId = created.batch.id;

    const estimates = await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.importBatchId, batchId));
    assert.equal(estimates.length, created.inserted);
    assert.ok(estimates.every(row => row.source === "estimated" && row.createdById === admin.id));
    const createdAt = new Date(created.batch.createdAt).getTime();
    assert.ok(estimates.every(row => row.recordedAt.getTime() >= createdAt));
    assert.ok(estimates.some(row => row.capturedAt.toISOString() === "2026-02-15T22:00:00.000Z"),
      "estimated snapshots use Libya midnight, not the server timezone");
    const actualOnFeb15 = await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, project.id));
    assert.equal(actualOnFeb15.filter(row => row.source === "actual" && row.capturedAt.toISOString() === "2026-02-15T10:00:00.000Z").length, 1);

    const staleRetry = await commit();
    assert.equal(staleRetry.status, 409, "retry with an old preview is rejected after history changes");
    const refreshedPreviewResponse = await fetch(`${base}/projects/${project.id}/progress-history-backfill/preview`, {
      method: "POST", headers: headers(adminToken), body: JSON.stringify(input),
    });
    const refreshedPreview = await refreshedPreviewResponse.json();
    const duplicateResponse = await fetch(`${base}/projects/${project.id}/progress-history-backfill/commit`, {
      method: "POST", headers: headers(adminToken),
      body: JSON.stringify({ input, previewToken: refreshedPreview.previewToken }),
    });
    assert.equal(duplicateResponse.status, 409, "the same reconstruction cannot be imported twice");

    const periodResponse = await fetch(
      `${base}/projects/${project.id}/reports/progress-as-of?periodEnd=2026-02-20&periodStart=2026-02-16`,
      { headers: headers(adminToken) },
    );
    const period = await periodResponse.json();
    assert.equal(periodResponse.status, 200, JSON.stringify(period));
    assert.equal(period.available, true);
    assert.equal(period.historySource, "estimated");
    assert.equal(period.plannedProgress, null, "the current schedule is not asserted as a historical plan");
    assert.equal(period.periodStartProgress, 20);
    assert.equal(period.periodIncrease, Math.round((period.overallProgress - 20) * 10) / 10);
    const savedReportResponse = await fetch(`${base}/projects/${project.id}/reports`, {
      method: "POST", headers: headers(adminToken),
      body: JSON.stringify({
        type: "period", reportDate: "2026-02-21", periodStart: "2026-02-16",
        periodEnd: "2026-02-20", workDescription: "Safe historical report",
        progressSource: "history", historyFingerprint: period.fingerprint,
      }),
    });
    const savedReport = await savedReportResponse.json();
    assert.equal(savedReportResponse.status, 201, JSON.stringify(savedReport));
    assert.equal(savedReport.progressStartPercentage, 20);
    assert.equal(savedReport.progressHistorySource, "estimated");

    await db.update(activitiesTable).set({ actualProgress: 50 }).where(eq(activitiesTable.id, active.id));
    const { captureProjectProgressHistory } = await import("../src/lib/capture-project-progress-history.ts");
    await captureProjectProgressHistory(project.id);
    const beforeRevertActual = await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, project.id));
    const revertResponse = await fetch(`${base}/projects/${project.id}/progress-history-backfill/batches/${batchId}/revert`, {
      method: "POST", headers: headers(adminToken), body: "{}",
    });
    const reverted = await revertResponse.json();
    assert.equal(revertResponse.status, 200, JSON.stringify(reverted));
    assert.equal(reverted.removed, created.inserted);
    const afterRevert = await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, project.id));
    assert.equal(afterRevert.filter(row => row.source === "estimated").length, 0);
    assert.equal(afterRevert.filter(row => row.source === "actual").length,
      beforeRevertActual.filter(row => row.source === "actual").length,
      "original and later actual captures survive rollback");
    assert.deepEqual(await db.select({
      id: activitiesTable.id, actualProgress: activitiesTable.actualProgress,
      status: activitiesTable.status,
    }).from(activitiesTable).where(eq(activitiesTable.projectId, project.id)),
    originalActivityValues.map(row => row.id === active.id ? { ...row, actualProgress: 50 } : row));
    assert.equal((await db.select().from(projectProgressHistoryBatchesTable)
      .where(eq(projectProgressHistoryBatchesTable.id, batchId)))[0].revertedAt instanceof Date, true);

    const noMissingHistoryResponse = await fetch(
      `${base}/projects/${project.id}/progress-history-backfill/automatic-preview`,
      { method: "POST", headers: headers(adminToken), body: "{}" },
    );
    assert.equal(noMissingHistoryResponse.status, 409,
      "the automatic action does not recreate activities that already have dated progress");

    const [automaticProject] = await db.insert(projectsTable).values({
      name: "Automatic backfill fixture", location: "fixture", ownerEntity: "fixture",
      supervisorEntity: "fixture", contractor: "fixture", startDate: "2026-01-01",
      expectedEndDate: "2026-12-31",
    }).returning();
    const [automaticActive] = await db.insert(activitiesTable).values({
      projectId: automaticProject.id, name: "Progress without dated history",
      status: "in_progress", actualStartDate: "2026-02-01", actualProgress: 35, weight: 1,
    }).returning();
    const [automaticCompleted] = await db.insert(activitiesTable).values({
      projectId: automaticProject.id, name: "Completed without dated history",
      status: "completed", actualStartDate: "2026-03-01", actualProgress: 100, weight: 1,
    }).returning();
    const automaticPreviewResponse = await fetch(
      `${base}/projects/${automaticProject.id}/progress-history-backfill/automatic-preview`,
      { method: "POST", headers: headers(adminToken), body: "{}" },
    );
    const automaticPreview = await automaticPreviewResponse.json();
    assert.equal(automaticPreviewResponse.status, 200, JSON.stringify(automaticPreview));
    assert.equal(automaticPreview.candidateActivities, 2);
    assert.equal(automaticPreview.estimatedCandidateActivities, 2);
    assert.equal(automaticPreview.input.periodStart, "2026-02-01");
    assert.equal(automaticPreview.input.automatic, true);
    assert.equal(automaticPreview.input.realityDate, automaticPreview.realityDate);
    assert.equal(automaticPreview.input.realityProgress, 67.5);
    assert.equal(automaticPreview.snapshotsToAdd, automaticPreview.days);
    assert.equal(await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, automaticProject.id)).then(rows => rows.length), 0,
    "previewing automatic estimates does not write history");

    const [restoreProject] = await db.insert(projectsTable).values({
      name: "Imported project restore fixture", location: "fixture", ownerEntity: "fixture",
      supervisorEntity: "fixture", contractor: "fixture", startDate: "2026-01-01",
      expectedEndDate: "2026-12-31",
    }).returning();
    const [restoreActivityA] = await db.insert(activitiesTable).values({
      projectId: restoreProject.id, name: "Imported activity A", status: "in_progress",
      actualStartDate: "2026-02-01", actualProgress: 30, weight: 1,
    }).returning();
    const [restoreActivityB] = await db.insert(activitiesTable).values({
      projectId: restoreProject.id, name: "Imported activity B", status: "in_progress",
      actualStartDate: "2026-03-01", actualProgress: 50, weight: 1,
    }).returning();
    const restoreNow = Date.now();
    const restoreSnapshot = rows => historicalSnapshot(restoreProject.id, rows.map(activity => ({
      id: activity.id, name: activity.name, actualProgress: activity.actualProgress,
      plannedProgress: 0, weight: 1, status: "in_progress", groupId: null, externalSourceGroupId: null,
    })));
    await db.insert(projectProgressHistoryTable).values([
      { projectId: restoreProject.id, capturedAt: new Date(restoreNow - 2_000), snapshot: restoreSnapshot([]) },
      { projectId: restoreProject.id, capturedAt: new Date(restoreNow - 1_000), snapshot: restoreSnapshot([restoreActivityA]) },
      { projectId: restoreProject.id, capturedAt: new Date(restoreNow), snapshot: restoreSnapshot([restoreActivityA, restoreActivityB]) },
    ]);
    const restorePreviewResponse = await fetch(
      `${base}/projects/${restoreProject.id}/progress-history-backfill/automatic-preview`,
      { method: "POST", headers: headers(adminToken), body: "{}" },
    );
    const restorePreview = await restorePreviewResponse.json();
    assert.equal(restorePreviewResponse.status, 200, JSON.stringify(restorePreview));
    assert.equal(restorePreview.restoreBurstDetected, true,
      "a same-day cumulative import burst is not treated as complete progress-history coverage");
    assert.equal(restorePreview.candidateActivities, 2);
    assert.equal(restorePreview.estimatedCandidateActivities, 2);
    assert.equal(restorePreview.snapshotsToSkip, 1,
      "the existing restore-day snapshot is retained instead of overwritten");
    assert.equal(await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, restoreProject.id)).then(rows => rows.length), 3,
    "preview leaves every imported snapshot unchanged");

    const todayParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = `${todayParts.find(part => part.type === "year").value}-${todayParts.find(part => part.type === "month").value}-${todayParts.find(part => part.type === "day").value}`;
    await db.insert(reportsTable).values({
      projectId: restoreProject.id, reportNumber: 1, type: "period", reportDate: today,
      periodStart: "2026-01-01", periodEnd: today, workDescription: "Saved report anchor",
      progressPercentage: 40, progressSource: "history", progressAsOfDate: today,
      activitiesSnapshot: [
        { id: restoreActivityA.id, actualProgress: 30, actualHistoricalUnverified: false },
        { id: restoreActivityB.id, actualProgress: 50, actualHistoricalUnverified: false },
      ],
    });
    const anchoredRestoreResponse = await fetch(
      `${base}/projects/${restoreProject.id}/progress-history-backfill/automatic-preview`,
      { method: "POST", headers: headers(adminToken), body: "{}" },
    );
    assert.equal(anchoredRestoreResponse.status, 409,
      "a saved report snapshot remains authoritative even beside a restore burst");

    const [linkedRestoreProject] = await db.insert(projectsTable).values({
      name: "Linked restore fixture", location: "fixture", ownerEntity: "fixture",
      supervisorEntity: "fixture", contractor: "fixture", startDate: "2026-01-01",
      expectedEndDate: "2026-12-31",
    }).returning();
    const [linkedRestoreActivity] = await db.insert(activitiesTable).values({
      projectId: linkedRestoreProject.id, name: "Linked imported activity", status: "in_progress",
      actualProgress: 30, weight: 1, externalSourceGroupId: sourceGroup.id,
    }).returning();
    const linkedRestoreSnapshot = rows => historicalSnapshot(linkedRestoreProject.id, rows);
    await db.insert(projectProgressHistoryTable).values([
      { projectId: linkedRestoreProject.id, capturedAt: new Date(restoreNow - 2_000), snapshot: linkedRestoreSnapshot([]) },
      { projectId: linkedRestoreProject.id, capturedAt: new Date(restoreNow), snapshot: linkedRestoreSnapshot([
        { id: linkedRestoreActivity.id, name: linkedRestoreActivity.name, actualProgress: 30,
          plannedProgress: 0, weight: 1, status: "in_progress", groupId: null,
          externalSourceGroupId: sourceGroup.id },
      ]) },
    ]);
    const linkedRestoreResponse = await fetch(
      `${base}/projects/${linkedRestoreProject.id}/progress-history-backfill/automatic-preview`,
      { method: "POST", headers: headers(adminToken), body: "{}" },
    );
    assert.equal(linkedRestoreResponse.status, 409,
      "linked-source history is not ignored by restore-burst detection");

    const automaticCommitResponse = await fetch(
      `${base}/projects/${automaticProject.id}/progress-history-backfill/commit`,
      {
        method: "POST", headers: headers(adminToken),
        body: JSON.stringify({ input: automaticPreview.input, previewToken: automaticPreview.previewToken }),
      },
    );
    const automaticCommit = await automaticCommitResponse.json();
    assert.equal(automaticCommitResponse.status, 201, JSON.stringify(automaticCommit));
    assert.equal(automaticCommit.inserted, automaticPreview.snapshotsToAdd);
    const automaticSnapshots = await db.select().from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.importBatchId, automaticCommit.batch.id));
    assert.ok(automaticSnapshots.every(row => row.source === "estimated"));
    const latestAutomaticSnapshot = automaticSnapshots.find(row =>
      row.capturedAt.toISOString() === new Date(`${automaticPreview.realityDate}T00:00:00+02:00`).toISOString());
    assert.ok(latestAutomaticSnapshot, "the estimate reaches the current progress at Libya midnight");
    assert.equal(latestAutomaticSnapshot.snapshot.activities.find(row => row.id === automaticActive.id).actualProgress, 35);
    const completedEstimate = latestAutomaticSnapshot.snapshot.activities.find(row => row.id === automaticCompleted.id);
    assert.equal(completedEstimate.actualProgress, 100);
    assert.equal(completedEstimate.actualEndDate, null, "automatic estimation does not invent an actual completion date");
    const liveAutomaticActivities = await db.select({
      id: activitiesTable.id, actualProgress: activitiesTable.actualProgress,
    }).from(activitiesTable).where(eq(activitiesTable.projectId, automaticProject.id));
    assert.deepEqual(liveAutomaticActivities, [
      { id: automaticActive.id, actualProgress: 35 },
      { id: automaticCompleted.id, actualProgress: 100 },
    ]);
    assert.equal(await pool.query("SELECT 1").then(result => result.rowCount), 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (schema?.pool) await schema.pool.end();
    await postgres.stop();
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  }
});
