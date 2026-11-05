import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { verifyDeviationBrowser } from "./helpers/deviation-browser.mjs";

test("deviation authenticated HTTP, source permissions, frozen history and optional real browser", {
  skip: process.env.DEVIATION_HTTP_TESTS !== "1", timeout: 240_000,
}, async t => {
  const postgres = await isolatedPostgres();
  let server, pool;
  try {
    const [{ default: app }, schema, { signToken }, { eq }, validators] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"), import("../lib/db/src/index.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"), import("../lib/db/node_modules/drizzle-orm/index.js"),
      import("../lib/api-zod/src/generated/api.ts"),
    ]);
    const { db, projectsTable, activitiesTable, activityGroupsTable, projectMembersTable, reportsTable, usersTable, projectSuspensionsTable, projectExtensionsTable, companiesTable, userCompaniesTable } = schema;
    pool = schema.pool;
    server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const today = new Date().toISOString().slice(0, 10);
    const offset = days => new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
    const [admin, engineer, stranger] = await db.insert(usersTable).values(["admin", "engineer", "engineer"].map((role, i) => ({
      phone: `fixture-${randomUUID()}`, passwordHash: "not-used", fullName: `test ${i}`, role,
    }))).returning();
    const [company] = await db.insert(companiesTable).values({ name: "fixture company", type: "owner" }).returning();
    await db.insert(userCompaniesTable).values({ userId: engineer.id, companyId: company.id });
    const token = u => signToken({ userId: u.id, phone: u.phone, role: u.role });
    const adminToken = token(admin), engineerToken = token(engineer), strangerToken = token(stranger);
    const createProject = async (name, extra = {}) => (await db.insert(projectsTable).values({
      name, location: "isolated", ownerEntity: "test", supervisorEntity: "test", contractor: "test",
      startDate: offset(-5), expectedEndDate: offset(5), ...extra,
    }).returning())[0];
    const target = await createProject("تحليل مشروع مرجعي");
    const source = await createProject("اسم مشروع مصدر محمي");
    const nested = await createProject("مشروع مصدر متداخل محمي");
    const unrelatedChild = await createProject("طفل تنظيمي غير مرتبط", { parentProjectId: target.id });
    const missing = await createProject("مشروع بدون جدول زمني", { noSchedule: true, startDate: null, expectedEndDate: null });
    const [targetGroup, sourceGroup, nestedGroup] = await db.insert(activityGroupsTable).values([
      { projectId: target.id, name: "أعمال الهدف" }, { projectId: source.id, name: "مجموعة محمية" },
      { projectId: nested.id, name: "متداخل" },
    ]).returning();
    const insertActivity = async (projectId, name, progress, weight, extra = {}) =>
      (await db.insert(activitiesTable).values({
        projectId, name, actualProgress: progress, weight,
        plannedStartDate: offset(-5), plannedEndDate: offset(5), ...extra,
      }).returning())[0];
    await insertActivity(target.id, "بند محلي", 20, 3, { groupId: targetGroup.id });
    const linked = await insertActivity(target.id, "بند مرتبط محفوظ", 88, 1, { externalSourceGroupId: sourceGroup.id, plannedProgress: 90 });
    await insertActivity(source.id, "عنصر مصدر موثق", 0, 1, { groupId: sourceGroup.id });
    await insertActivity(source.id, "ربط متداخل", 99, 3, { groupId: sourceGroup.id, externalSourceGroupId: nestedGroup.id });
    await insertActivity(nested.id, "اسم بند متداخل سري", 40, 1, { groupId: nestedGroup.id });
    await insertActivity(unrelatedChild.id, "يجب ألا يحتسب", 100, 100);
    await insertActivity(missing.id, "بند بلا جدول", 42, 1, { plannedStartDate: null, plannedEndDate: null });
    const [membership] = await db.insert(projectMembersTable).values({
      userId: engineer.id, projectId: target.id, role: "engineer",
    }).returning();
    async function get(path, credential = adminToken, expected = 200) {
      const r = await fetch(`${origin}/api${path}`, { headers: credential ? { Authorization: `Bearer ${credential}` } : {} });
      assert.equal(r.status, expected, `${path}: ${await r.clone().text()}`);
      return r.headers.get("content-type")?.includes("application/json") ? r.json() : { error: await r.text() };
    }
    const endpoint = `/projects/${target.id}/deviation`;
    const before = await db.select().from(activitiesTable);
    await t.test("manual mixed/nested reference, zero rows, no portfolio aggregation and contract", async () => {
      const a = await get(endpoint);
      assert.equal(a.actualProgress, 22.5); assert.equal(a.plannedProgress, 50); assert.equal(a.progressDeviation, -27.5);
      assert.equal(a.activitiesAnalysis.length, 2); assert.equal(a.netDelayDays, null);
      assert.equal(a.activitiesAnalysis.reduce((s, r) => s + r.weightedImpact, 0), -27.5);
      assert.equal(a.activitiesAnalysis[1].sourceDetails[1].children[0].effectiveWeight, 18.75);
      assert.equal(a.forecastCompletionDate > today, true);
      assert(validators.GetProjectDeviationResponse.parse(a));
    });
    await t.test("summary, deviation and executive response share a calculation snapshot; AI cannot substitute numbers", async () => {
      const aiEndpoint=`/projects/${target.id}/ai-executive-summary`;
      await get(aiEndpoint,null,401);await get(aiEndpoint,strangerToken,403);
      await get(`${aiEndpoint}?curve=invalid`,adminToken,400);
      await get(`/projects/${target.id}/summary?curve=invalid`,adminToken,400);
      const originalFetch=globalThis.fetch;
      await db.insert(projectExtensionsTable).values([
        {projectId:target.id,extensionDate:today,daysAdded:2,newEndDate:offset(7)},
        {projectId:target.id,extensionDate:today,daysAdded:3,newEndDate:offset(10)},
        {projectId:unrelatedChild.id,extensionDate:today,daysAdded:999,newEndDate:offset(1004)},
      ]);
      let unsupported=false;
      let rejectNext=false,providerCalls=0;
      globalThis.fetch=async (url,options)=>{
        if (String(url).startsWith("https://api.perplexity.ai/")) {
          providerCalls++;
          const prompt=JSON.parse(JSON.parse(options.body).messages[1].content);
          const risk=prompt.evidence.find(f=>f.risk),highlight=prompt.evidence.find(f=>f.highlight);
          const selection={highlights:highlight?[highlight.id]:[],risks:risk?[risk.id]:[],
            nextActions:risk?[{evidenceId:risk.id,action:"review_progress"}]:[],managementFocus:risk?[risk.id]:[]};
          if (unsupported || rejectNext) selection.risks=["fabricated-id"];
          rejectNext=false;
          return Response.json({choices:[{message:{content:JSON.stringify({...selection,progressNote:"999%",scheduleOutlook:"2099-01-01"})}}]});
        }
        return originalFetch(url,options);
      };
      try {
        for (const curve of ["linear","scurve"]) {
          const a=await get(`${endpoint}?curve=${curve}`);
          const s=await get(`/projects/${target.id}/summary?curve=${curve}`);
          assert(validators.GetProjectSummaryResponse.parse(s));
          assert.equal(s.overallProgress,Math.round(a.actualProgress*10)/10);
          assert.equal(s.plannedProgress,Math.round(a.plannedProgress*10)/10);
          assert.equal(s.spi,a.spi);assert.equal(s.netDelayDays,null);
          assert.equal(s.forecastCompletionDate,a.forecastCompletionDate);
          const ai=await get(`${aiEndpoint}?curve=${curve}`);
          assert.equal(ai.snapshot.analysis.actualProgress,a.actualProgress);
          assert.equal(ai.snapshot.analysis.plannedProgress,a.plannedProgress);
          assert.equal(ai.snapshot.analysis.forecastCompletionDate,a.forecastCompletionDate);
          assert.equal(ai.snapshot.analysis.curve,curve);
          assert.equal(ai.snapshot.extensionDays,5,"extensions belong only to this project");
          assert(ai.summary.scheduleOutlook.includes(a.forecastCompletionDate));
          assert(!JSON.stringify(ai.summary).includes("999"));
          assert(!JSON.stringify(ai.summary).includes("2099"));
        }
        const restricted=await get(aiEndpoint,engineerToken);
        assert(!JSON.stringify(restricted).includes(source.name));
        assert(!JSON.stringify(restricted).includes(nested.name));
        const noSchedule=await get(`/projects/${missing.id}/summary`);
        assert.equal(noSchedule.plannedProgress,null);assert.equal(noSchedule.delayDays,null);
        assert(validators.GetProjectSummaryResponse.parse(noSchedule));
        const unplanned=await get(`/projects/${missing.id}/ai-executive-summary`);
        assert.equal(unplanned.summary.status,"غير متاح");
        assert.equal(unplanned.snapshot.extensionDays,0,"a project without extensions cannot inherit another project's days");
        rejectNext=true;const callsBefore=providerCalls;
        await get(aiEndpoint);assert.equal(providerCalls-callsBefore,2,"one invalid selection is retried before publication");
        unsupported=true;await get(aiEndpoint,adminToken,502);
        assert.deepEqual(await db.select().from(activitiesTable),before,"read-only analysis never mutates source or target values");
      } finally {globalThis.fetch=originalFetch;}
    });
    await t.test("unauthenticated, no membership, hidden deviation denied and independent source disclosure", async () => {
      await get(endpoint, null, 401); await get(endpoint, strangerToken, 403);
      let a = await get(endpoint, engineerToken);
      assert.equal(a.activitiesAnalysis[1].sourceStatus, "restricted");
      assert(!JSON.stringify(a).includes(source.name)); assert(!JSON.stringify(a).includes("عنصر مصدر موثق"));
      const [sourceMembership] = await db.insert(projectMembersTable).values({ userId: engineer.id, projectId: source.id, role: "engineer" }).returning();
      a = await get(endpoint, engineerToken);
      assert(JSON.stringify(a).includes(source.name)); assert(!JSON.stringify(a).includes(nested.name));
      assert(!JSON.stringify(a).includes("اسم بند متداخل سري"));
      await db.update(projectMembersTable).set({ tabPermissions: { activities: "hidden" } }).where(eq(projectMembersTable.id, sourceMembership.id));
      a = await get(endpoint, engineerToken);
      assert(!JSON.stringify(a).includes(source.name));
      assert.deepEqual(a.activitiesAnalysis[1].sourceDetails, []);
      await db.update(projectMembersTable).set({ tabPermissions: null }).where(eq(projectMembersTable.id, sourceMembership.id));
      await db.update(projectMembersTable).set({ tabPermissions: { deviation: "hidden" } }).where(eq(projectMembersTable.id, membership.id));
      await get(endpoint, engineerToken, 403); await get(`${endpoint}/timeline`, engineerToken, 403);
      await db.update(projectMembersTable).set({ tabPermissions: null }).where(eq(projectMembersTable.id, membership.id));
    });
    await t.test("period snapshot not current schedule; same-day multiple reports and live remain independent", async () => {
      const day = offset(-2);
      const snapshot = [{ id: 1, plannedProgress: 40, actualProgress: 12, weight: 1,
        plannedHistoricalUnverified: false, actualAsOfDate: day, actualHistoricalUnverified: false }];
      await db.insert(reportsTable).values([
        { projectId: target.id, type: "weekly", reportDate: today, periodStart: day, periodEnd: day, workDescription: "test", activitiesSnapshot: snapshot },
        { projectId: target.id, type: "weekly", reportDate: today, periodStart: today, periodEnd: today, workDescription: "today", activitiesSnapshot: [] },
        { projectId: target.id, type: "weekly", reportDate: today, periodStart: today, periodEnd: today, workDescription: "today 2", activitiesSnapshot: null },
      ]);
      const saved = await db.select().from(reportsTable);
      const tl = await get(`${endpoint}/timeline`);
      assert.equal(tl.points.length, 4);
      assert.equal(tl.points[0].date, day); assert.equal(tl.points[0].actualProgress, 12);
      assert.equal(tl.points[0].plannedProgress, 40);
      assert.equal(tl.points[1].actualProgress, null); assert.equal(tl.points[2].actualProgress, null);
      assert.equal(tl.points[3].kind, "live"); assert.equal(tl.points[3].actualProgress, 22.5);
      assert(validators.GetProjectDeviationTimelineResponse.parse(tl));
      assert.deepEqual(await db.select().from(reportsTable), saved);
      await db.update(projectMembersTable).set({ tabPermissions: { reports: "hidden" } }).where(eq(projectMembersTable.id, membership.id));
      assert.equal((await get(`${endpoint}/timeline`, engineerToken)).points.length, 1);
      await db.update(projectMembersTable).set({ tabPermissions: null }).where(eq(projectMembersTable.id, membership.id));
    });
    await t.test("elapsed overlapping/shifted suspensions never auto-deduct future or contractor days", async () => {
      await db.insert(projectSuspensionsTable).values([
        { projectId: target.id, type: "official_holiday", title: "A", startDate: offset(-5), endDate: offset(-1), calendarDays: 5, datesShifted: true },
        { projectId: target.id, type: "force_majeure", title: "B", startDate: offset(-2), endDate: offset(2), calendarDays: 5 },
        { projectId: target.id, type: "contractor_delay", title: "C", startDate: offset(-1), endDate: today, calendarDays: 2 },
      ]);
      const a = await get(endpoint);
      assert.equal(a.suspensionDays, 6); assert.equal(a.shiftedSuspensionDays, 5);
      assert.equal(a.unshiftedSuspensionDays, 1); assert.equal(a.contractorSuspensionDays, 2);
      assert.equal(a.netDelayDays, null);
      assert.deepEqual(await db.select().from(activitiesTable), before);
    });
    await t.test("missing schedule retains actual/items; missing project and unrelated URL rejected", async () => {
      const a = await get(`/projects/${missing.id}/deviation`);
      assert.equal(a.actualProgress, 42); assert.equal(a.plannedProgress, null); assert.equal(a.status, "unavailable");
      assert.equal(a.overrunDays, null); assert.equal(a.activitiesAnalysis[0].activityName, "بند بلا جدول");
      await get(`/projects/2147483647/deviation`, adminToken, 404);
      // There is no unscoped source-details endpoint that can be substituted.
      await get(`${endpoint}/sources/${unrelatedChild.id}`, adminToken, 404);
    });
    if (process.env.DEVIATION_BROWSER_TESTS === "1") {
      await t.test("real browser desktop/mobile/dark, search, pagination and nested details", async () => {
        await db.insert(activitiesTable).values(Array.from({ length: 55 }, (_, i) => ({
          projectId: target.id, name: `بند إضافي ${i}`, weight: 1, actualProgress: 0,
          plannedStartDate: offset(-5), plannedEndDate: offset(5),
        })));
        await verifyDeviationBrowser(origin, target.id, adminToken, missing.id);
      });
    }
    await t.test("deleted source preserves last saved target values and disables live forecast", async () => {
      await db.delete(activityGroupsTable).where(eq(activityGroupsTable.id, sourceGroup.id));
      const a = await get(endpoint);
      const row = a.activitiesAnalysis.find(r => r.activityId === linked.id);
      assert.equal(row.actualProgress, 88); assert.equal(row.plannedProgress, 90);
      assert.equal(row.sourceStatus, "stale"); assert.equal(a.dataStatus, "stale"); assert.equal(a.forecastCompletionDate, null);
      await db.update(projectsTable).set({expectedEndDate:offset(-1)}).where(eq(projectsTable.id,target.id));
      const stalePastEnd=await get(endpoint);
      assert.equal(stalePastEnd.overrunDays,null,"past end plus stale linked progress does not prove overrun");
      const staleSummary=await get(`/projects/${target.id}/summary`);
      assert.equal(staleSummary.overrunDays,null);
      assert.equal(staleSummary.dataStatus,"stale");
    });
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (pool) await pool.end();
    await postgres.stop();
  }
});
