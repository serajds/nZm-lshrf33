import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/report-forecast.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "forecast-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        contents: args.path === "db"
          ? `export const projectsTable = { kind: "project" };
             export const activitiesTable = { kind: "activities" };
             export const reportsTable = { kind: "reports" };
             export const db = { select: () => ({
               from: table => ({
                 where: () => table === projectsTable
                   ? Promise.resolve([globalThis.forecastProject])
                   : { orderBy: async () => table === reportsTable
                       ? globalThis.forecastReports ?? []
                       : globalThis.forecastActivities },
               }),
             }) };`
          : args.path === "external"
            ? "export const getGroupSummaries = async () => globalThis.forecastSummaries ?? new Map();"
            : args.path === "drizzle"
               ? "export const asc = value => value; export const desc = value => value; export const eq = (left, right) => [left, right];"
            : args.path === "progress"
              ? `export const calcActivityPlannedProgress = (activity, asOf) =>
                  !activity.plannedStartDate || asOf < new Date(activity.plannedStartDate) ? 0 : 100;
                  export const hasValidProjectSchedule = (start, end) => Boolean(start && end && end >= start);
                  export const roundPercent = value => Math.round(value * 10) / 10;`
              : `export const getReportPeriodProgress = async (_id, day) =>
                  globalThis.forecastHistory(day);
                 export const validReportDay = value => /^\\d{4}-\\d{2}-\\d{2}$/.test(value)
                   && !Number.isNaN(Date.parse(value))
                   && new Date(value).toISOString().slice(0, 10) === value;`,
      }));
      builder.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: "drizzle", namespace: "fixture" }));
      builder.onLoad({ filter: /^drizzle$/, namespace: "fixture" }, () => ({
         contents: "export const asc = value => value; export const desc = value => value; export const eq = (left, right) => [left, right];",
      }));
      builder.onResolve({ filter: /^\.\/external-sources$/ }, () => ({ path: "external", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/progress$/ }, () => ({ path: "progress", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/report-period-progress$/ }, () => ({ path: "history", namespace: "fixture" }));
    },
  }],
});
const { buildForecastActivities, getReportForecastProgress } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const activity = (id, extra = {}) => ({
  id, name: `item ${id}`, groupId: null, plannedStartDate: "2026-10-01",
  plannedEndDate: "2026-10-31", actualStartDate: null, actualEndDate: null,
  externalSourceGroupId: null, actualProgress: 0, plannedProgress: 0,
  weight: 1, status: "not_started", sortOrder: id, ...extra,
});

function setupForecast({ history, activities = [activity(1)], reports = [], startDate = "2026-10-01", endDate = "2026-11-30" }) {
  globalThis.forecastProject = { noSchedule: false, startDate, expectedEndDate: endDate };
  globalThis.forecastActivities = activities;
  globalThis.forecastSummaries = new Map();
  globalThis.forecastReports = reports;
  globalThis.forecastHistory = async day => history(day);
}

test("future schedule status is kept separate from actual progress dated today", () => {
  const [result] = buildForecastActivities(
    [activity(1)],
    new Map([[1, { value: 100, verified: true }]]),
    [{ id: 1, actualProgress: 35, status: "in_progress", actualRecordedAt: "2026-10-24T10:00:00Z" }],
    "2026-11-10",
    "2026-10-24",
  );
  assert.equal(result.plannedProgress, 100);
  assert.equal(result.actualProgress, 35);
  assert.equal(result.actualAsOfDate, "2026-10-24");
  assert.equal(result.status, "completed");
  assert.equal(result.forecastStatus, "completed");
});

test("missing or estimated actual history stays unavailable without changing schedule expectation", () => {
  const result = buildForecastActivities(
    [activity(1)],
    new Map([[1, { value: 25, verified: true }]]),
    [
      { id: 1, actualProgress: 92, status: "in_progress", actualHistoryEstimated: true },
    ],
    "2026-10-24",
    "2026-10-24",
  )[0];
  assert.equal(result.actualProgress, null);
  assert.equal(result.actualHistoricalUnverified, true);
  assert.equal(result.plannedProgress, 25);
  assert.equal(result.status, "in_progress");
  assert.equal(result.forecastStatus, "in_progress");
});

test("past target uses its verified actual status while retaining the schedule expectation separately", () => {
  const result = buildForecastActivities(
    [activity(1)],
    new Map([[1, { value: 100, verified: true }]]),
    [{ id: 1, actualProgress: 60, status: "in_progress" }],
    "2026-10-20",
    "2026-10-20",
  )[0];
  assert.equal(result.actualProgress, 60);
  assert.equal(result.status, "in_progress");
  assert.equal(result.forecastStatus, "completed");
});

test("future preview sources actual progress from today and planned progress from the target schedule", async () => {
  setupForecast({
    history: async day => ({
      available: true,
      historySource: "actual",
      overallProgress: 40,
      plannedProgress: 35,
      activities: [{
        id: 1, actualProgress: 40, plannedProgress: 35, status: "in_progress",
        actualStartDate: "2026-10-05", actualEndDate: null,
        actualRecordedAt: "2026-10-24T12:00:00Z",
      }],
    }),
  });
  const preview = await getReportForecastProgress(
    1, "2026-11-10", new Date("2026-10-24T15:00:00Z"),
  );
  assert.equal(preview.today, "2026-10-24");
  assert.equal(preview.actualAsOfDate, "2026-10-24");
  assert.equal(preview.actualProgress, 40);
  assert.equal(preview.plannedProgress, 100);
  assert.equal(preview.activities[0].actualProgress, 40);
  assert.equal(preview.activities[0].plannedProgress, 100);
  assert.equal(preview.activities[0].status, "completed");
});

test("future preview never substitutes today's activity value when history is unavailable", async () => {
  setupForecast({
    activities: [activity(1, { actualProgress: 95, status: "in_progress" })],
    history: async () => ({
      available: false, historySource: null, overallProgress: null, plannedProgress: null, activities: null,
    }),
  });
  const preview = await getReportForecastProgress(
    1, "2026-11-10", new Date("2026-10-24T15:00:00Z"),
  );
  assert.equal(preview.actualAvailable, false);
  assert.equal(preview.actualProgress, null);
  assert.equal(preview.activities[0].actualProgress, null);
  assert.equal(preview.activities[0].actualHistoricalUnverified, true);
  assert.equal(preview.activities[0].plannedProgress, 100);
});

test("a past forecast draft uses trusted historical actual and planned snapshots", async () => {
  setupForecast({
    history: async () => ({
      available: true,
      historySource: "actual",
      overallProgress: 60,
      plannedProgress: 55,
      activities: [{
        id: 1, actualProgress: 60, plannedProgress: 55, status: "in_progress",
        actualRecordedAt: "2026-10-20T12:00:00Z",
      }],
    }),
  });
  const preview = await getReportForecastProgress(
    1, "2026-10-20", new Date("2026-10-24T15:00:00Z"),
  );
  assert.equal(preview.actualAsOfDate, "2026-10-20");
  assert.equal(preview.actualProgress, 60);
  assert.equal(preview.plannedProgress, 55);
  assert.equal(preview.activities[0].actualProgress, 60);
  assert.equal(preview.activities[0].plannedProgress, 55);
});

test("a complete reviewed estimated history supplies only the aggregate and keeps item actuals unverified", async () => {
  setupForecast({
    history: async () => ({
      available: true,
      historySource: "estimated",
      overallProgress: 39.6,
      plannedProgress: null,
      activities: [{
        id: 1, actualProgress: 39.6, plannedProgress: 0, status: "in_progress",
        actualHistoryEstimated: true,
      }],
    }),
  });
  const preview = await getReportForecastProgress(
    1, "2026-11-20", new Date("2026-11-22T12:00:00.000Z"),
  );
  assert.equal(preview.actualAvailable, true);
  assert.equal(preview.actualProgress, 39.6);
  assert.equal(preview.actualSource, "estimated_history");
  assert.equal(preview.activities[0].actualProgress, null);
  assert.equal(preview.activities[0].actualHistoricalUnverified, true);
});

test("an approved report for the exact date supplies the saved actual total only", async () => {
  setupForecast({
    reports: [{
      reportNumber: 7, status: "approved", forecastDraft: false, periodEnd: "2026-07-31",
      reportDate: "2026-08-10", progressPercentage: 22.6, progressSource: null, progressAsOfDate: null,
    }],
    history: async () => ({
      available: false, historySource: "estimated", overallProgress: null,
      plannedProgress: null, activities: [{ id: 1, actualProgress: 80, actualHistoricalUnverified: true }],
    }),
  });
  const preview = await getReportForecastProgress(
    1, "2026-07-31", new Date("2026-10-24T15:00:00Z"),
  );
  assert.equal(preview.actualAvailable, true);
  assert.equal(preview.actualProgress, 22.6);
  assert.equal(preview.actualSource, "approved_report");
  assert.equal(preview.actualReportNumber, 7);
  assert.equal(preview.activities[0].actualProgress, null);
  assert.equal(preview.activities[0].actualHistoricalUnverified, true);
});

test("an exact-date manual draft is offered for review, never auto-treated as actual", async () => {
  setupForecast({
    reports: [{
      reportNumber: 10, status: "draft", forecastDraft: false, periodEnd: "2026-09-21",
      reportDate: "2026-10-15", progressPercentage: 25.9, progressSource: "manual",
      progressAsOfDate: "2026-09-21",
    }],
    history: async () => ({
      available: false, historySource: "estimated", overallProgress: null,
      plannedProgress: null, activities: [{ id: 1, actualProgress: 80, actualHistoricalUnverified: true }],
    }),
  });
  const preview = await getReportForecastProgress(
    1, "2026-09-21", new Date("2026-10-24T15:00:00Z"),
  );
  assert.equal(preview.actualAvailable, false);
  assert.equal(preview.actualProgress, null);
  assert.deepEqual(preview.manualSuggestion, {
    reportNumber: 10, progressPercentage: 25.9,
    actualAsOfDate: "2026-09-21", reportDate: "2026-10-15",
  });
});

test("a draft's manual value is not suggested for another date or a future target", async () => {
  const draft = {
    reportNumber: 10, status: "draft", forecastDraft: false, periodEnd: "2026-09-21",
    reportDate: "2026-10-15", progressPercentage: 25.9, progressSource: "manual",
    progressAsOfDate: "2026-09-21",
  };
  setupForecast({
    reports: [draft],
    history: async () => ({
      available: false, historySource: "estimated", overallProgress: null,
      plannedProgress: null, activities: [],
    }),
  });
  const otherDate = await getReportForecastProgress(
    1, "2026-09-20", new Date("2026-10-24T15:00:00Z"),
  );
  assert.equal(otherDate.manualSuggestion, null);
  const future = await getReportForecastProgress(
    1, "2026-11-10", new Date("2026-10-24T15:00:00Z"),
  );
  assert.equal(future.manualSuggestion, null);
});
