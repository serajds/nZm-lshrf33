import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { Server } from "node:http";
import { db, pool, projectsTable, activityGroupsTable, activitiesTable, reportsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { signToken } from "../src/lib/auth";
import { reconcileGroupToSideProject, refreshLinkedSources } from "../src/lib/external-sources";

if (process.env.NODE_ENV !== "development" || !process.env.DATABASE_URL) {
  throw new Error("Performance fixtures are permitted only in development");
}

const projectIds: number[] = [];
let userId: number | undefined;
let server: Server | undefined;

async function timed(label: string, action: () => Promise<unknown>, repetitions = 3) {
  const durations: number[] = [];
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    await action();
    durations.push(Math.round((performance.now() - started) * 10) / 10);
  }
  durations.sort((a, b) => a - b);
  console.log(JSON.stringify({ label, runsMs: durations, medianMs: durations[Math.floor(durations.length / 2)] }));
}

async function main() {
  try {
    const suffix = `hardening-perf-${Date.now()}`;
    const [user] = await db.insert(usersTable).values({
      phone: suffix, passwordHash: "temporary-test-only", fullName: "Performance fixture", role: "admin",
    }).returning();
    userId = user.id;
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const headers = { authorization: `Bearer ${signToken({ userId: user.id, phone: user.phone, role: "admin" })}` };
    const today = new Date();
    const day = (offset: number) => {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const baseProject = {
      location: "temporary-test", ownerEntity: "test", supervisorEntity: "test", contractor: "test",
      noSchedule: false, startDate: day(-20), expectedEndDate: day(20),
    };
    for (const size of [500, 1000]) {
      const [source, target] = await db.insert(projectsTable).values([
        { ...baseProject, name: `${suffix}-source-${size}` },
        { ...baseProject, name: `${suffix}-target-${size}` },
      ]).returning();
      projectIds.push(source.id, target.id);
      const [sourceGroup, targetGroup] = await db.insert(activityGroupsTable).values([
        { projectId: source.id, name: "Source" },
        { projectId: target.id, name: "Managed" },
      ]).returning();
      const rows = Array.from({ length: size }, (_, index) => ({
        projectId: source.id,
        groupId: sourceGroup.id,
        name: `Temporary item ${index}`,
        weight: index % 3 + 1,
        actualProgress: index % 2 === 0 ? 60 : 0,
        plannedStartDate: day(-20),
        plannedEndDate: day(20),
        sortOrder: index,
      }));
      for (let offset = 0; offset < rows.length; offset += 200) {
        await db.insert(activitiesTable).values(rows.slice(offset, offset + 200));
      }
      const reportRows = rows.map((row, index) => ({
        id: index + 1, name: row.name, weight: row.weight, actualProgress: row.actualProgress,
        plannedProgress: 50, plannedStartDate: row.plannedStartDate, plannedEndDate: row.plannedEndDate,
        plannedAsOfDate: day(0), actualRecordedAt: new Date().toISOString(),
      }));
      const [report] = await db.insert(reportsTable).values({
        projectId: source.id, type: "weekly", reportDate: day(0), periodStart: day(-7),
        periodEnd: day(0), workDescription: "Temporary performance fixture",
        progressPercentage: 30, activitiesSnapshot: reportRows,
      }).returning();
      console.log(JSON.stringify({ size, phase: "begin" }));
      const request = async (path: string, pdf = false) => {
        const response = await fetch(`${base}${path}`, { headers });
        assert.equal(response.status, 200, `${path}: ${response.status}`);
        if (pdf) {
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(bytes.toString("ascii", 0, 4), "%PDF");
          return bytes.length;
        }
        return response.json();
      };
      await timed(`${size}:activities`, () => request(`/projects/${source.id}/activities`));
      await timed(`${size}:summary`, () => request(`/projects/${source.id}/summary`));
      await timed(`${size}:deviation`, () => request(`/projects/${source.id}/deviation`));
      await timed(`${size}:dashboard`, () => request("/dashboard/summary"));
      await timed(`${size}:sync-create`, () => reconcileGroupToSideProject(targetGroup.id, source.id), 1);
      await timed(`${size}:sync-refresh`, () => refreshLinkedSources([sourceGroup.id]), 1);
      await timed(`${size}:report-pdf`, () => request(`/projects/${source.id}/reports/export-pdf?reportId=${report.id}`, true), 1);
      console.log(JSON.stringify({ size, phase: "complete" }));
    }
  } finally {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve()));
    for (const projectId of projectIds.reverse()) {
      await db.delete(reportsTable).where(eq(reportsTable.projectId, projectId));
      await db.delete(activitiesTable).where(eq(activitiesTable.projectId, projectId));
      await db.delete(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    if (userId != null) await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
    console.log("Performance fixtures cleaned");
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});