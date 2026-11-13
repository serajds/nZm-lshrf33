import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/capture-project-progress-history.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "progress-history-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db-fixture", namespace: "fixture" }));
      builder.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: "drizzle-fixture", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "drizzle-fixture"
          ? `export const asc = value => value;
             export const desc = value => value;
             export const eq = (left, right) => ({ left, right });
             export const sql = (parts, ...values) => ({ parts, values });`
          : `const table = (name, columns) => Object.assign({ tableName: name },
               Object.fromEntries(columns.map(column => [column, { tableName: name, column }])));
             export const activitiesTable = table("activities", [
               "id", "name", "groupId", "plannedStartDate", "plannedEndDate",
               "actualStartDate", "actualEndDate", "actualProgress", "plannedProgress",
               "externalSourceGroupId", "weight", "status", "sortOrder"
             ]);
             export const activityGroupsTable = table("activityGroups", ["id", "name"]);
             export const projectProgressHistoryTable = table("history", [
               "id", "projectId", "capturedAt", "snapshot"
             ]);
             export const projectsTable = table("projects", [
               "id", "noSchedule", "startDate", "expectedEndDate"
             ]);
             export const fixtureState = {
               project: { id: 1, noSchedule: false, startDate: "2026-01-01", expectedEndDate: "2026-12-31" },
               activities: [{
                 id: 4, name: "Activity", groupId: null, plannedStartDate: "2026-01-01",
                 plannedEndDate: "2026-12-31", actualStartDate: null, actualEndDate: null,
                 actualProgress: 0, plannedProgress: 0, externalSourceGroupId: null,
                 weight: 1, status: "not_started", sortOrder: 1
               }],
               groups: [], history: [], failHistoryInsert: false
             };
             const clone = value => structuredClone(value);
             const rowsFor = query => {
               if (query.table === projectsTable) return [fixtureState.project];
               if (query.table === activitiesTable) return fixtureState.activities;
               if (query.table === activityGroupsTable) return fixtureState.groups;
               if (query.table === projectProgressHistoryTable) {
                 const latest = fixtureState.history.at(-1);
                 return latest ? [{ snapshot: latest.snapshot }] : [];
               }
               return [];
             };
             class SelectQuery {
               from(table) { this.table = table; return this; }
               where() { return this; }
               orderBy() { return this; }
               limit() { return this; }
               then(resolve, reject) {
                 try { return Promise.resolve(rowsFor(this)).then(resolve, reject); }
                 catch (error) { return Promise.reject(error).then(resolve, reject); }
               }
             }
             const tx = {
               execute: async () => undefined,
               select: () => new SelectQuery(),
               insert: table => ({
                 values: async value => {
                   if (table === projectProgressHistoryTable && fixtureState.failHistoryInsert) {
                     throw new Error("synthetic history insert failure");
                   }
                   if (table === projectProgressHistoryTable) fixtureState.history.push(value);
                 }
               })
             };
             export const db = {
               transaction: async work => {
                 const before = clone(fixtureState);
                 try { return await work(tx); }
                 catch (error) {
                   for (const key of Object.keys(fixtureState)) delete fixtureState[key];
                   Object.assign(fixtureState, before);
                   throw error;
                 }
               }
             };
             globalThis.progressHistoryFixtureState = fixtureState;
             globalThis.progressHistoryFixtureDb = db;`,
      }));
    },
  }],
});

const loaded = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("history insert failure rolls back the activity change in the same transaction", async () => {
  const db = globalThis.progressHistoryFixtureDb;
  const fixtureState = globalThis.progressHistoryFixtureState;
  fixtureState.activities[0].actualProgress = 0;
  fixtureState.history = [];
  fixtureState.failHistoryInsert = true;

  await assert.rejects(
    db.transaction(async tx => {
      fixtureState.activities[0].actualProgress = 65;
      await loaded.captureProjectProgressHistory(1, tx);
    }),
    /synthetic history insert failure/,
  );

  assert.equal(fixtureState.activities[0].actualProgress, 0);
  assert.equal(fixtureState.history.length, 0);
});
