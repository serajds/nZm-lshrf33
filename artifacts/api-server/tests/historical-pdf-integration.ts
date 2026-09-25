import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { db, pool, projectsTable, activitiesTable, reportsTable, usersTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { signToken } from "../src/lib/auth";

if (process.env.NODE_ENV !== "development" || !process.env.DATABASE_URL) {
  throw new Error("Historical PDF integration requires a development database");
}
if (!existsSync("src/fonts/Amiri-Regular.ttf")) {
  throw new Error("Run this check from artifacts/api-server so the PDF includes its Arabic font");
}

let projectId: number | undefined;
let userId: number | undefined;
let server: Server | undefined;

async function main() {
  try {
    const name = `historical-pdf-check-${Date.now()}`;
    const [user] = await db.insert(usersTable).values({
      phone: name, passwordHash: "temporary-test-only", fullName: "Historical PDF test", role: "admin",
    }).returning();
    userId = user.id;
    const [project] = await db.insert(projectsTable).values({
      name, location: "test", ownerEntity: "test", supervisorEntity: "test", contractor: "test",
      noSchedule: false, startDate: "2026-04-01", expectedEndDate: "2026-04-11",
    }).returning();
    projectId = project.id;
    const [activity] = await db.insert(activitiesTable).values({
      projectId, name: "Historical item", weight: 1, actualProgress: 40,
      plannedStartDate: "2026-04-01", plannedEndDate: "2026-04-11",
    }).returning();
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/projects/${projectId}`;
    const authorization = `Bearer ${signToken({ userId, phone: user.phone, role: "admin" })}`;
    const createResponse = await fetch(`${base}/reports`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        type: "weekly", reportDate: "2026-04-06", periodStart: "2026-04-01",
        periodEnd: "2026-04-06", workDescription: "Temporary acceptance check",
        progressPercentage: 37,
      }),
    });
    assert.equal(createResponse.status, 201);
    const report = await createResponse.json() as {
      id: number; progressPercentage: number;
      activitiesSnapshot: Array<{ plannedProgress: number; actualProgress: number; plannedAsOfDate: string }>;
    };
    assert.equal(report.progressPercentage, 37);
    assert.equal(report.activitiesSnapshot[0].plannedAsOfDate, "2026-04-06");
    assert.equal(report.activitiesSnapshot[0].plannedProgress, 50);
    assert.equal(report.activitiesSnapshot[0].actualProgress, 40);

    await db.update(activitiesTable).set({ actualProgress: 80, plannedStartDate: "2026-04-03" })
      .where(eq(activitiesTable.id, activity.id));
    const [saved] = await db.select().from(reportsTable).where(eq(reportsTable.id, report.id));
    assert.equal((saved.activitiesSnapshot as typeof report.activitiesSnapshot)[0].actualProgress, 40);

    const pdfResponse = await fetch(`${base}/reports/export-pdf?reportId=${report.id}`, {
      headers: { authorization },
    });
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get("content-type") ?? "", /application\/pdf/);
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(pdf.toString("ascii", 0, 4), "%PDF");
    const extracted = spawnSync("pdftotext", ["-layout", "-", "-"], {
      input: pdf, encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const value of ["50%", "40%", "37%", "SPI"]) {
      assert.ok(extracted.stdout.includes(value), `PDF is missing ${value}`);
    }
    console.log("Historical report API snapshot 50/40, manual 37, subsequent actual 80, and PDF content passed");
  } finally {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve()));
    if (projectId != null) {
      await db.delete(reportsTable).where(eq(reportsTable.projectId, projectId));
      await db.delete(activitiesTable).where(eq(activitiesTable.projectId, projectId));
      await db.delete(auditLogTable).where(eq(auditLogTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    if (userId != null) await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});