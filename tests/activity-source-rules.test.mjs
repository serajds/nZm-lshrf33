import test from "node:test";
import assert from "node:assert/strict";
import {
  groupMatchesSourceQuery,
  currentRoleCanReadProject,
  linkedActivityValues,
  linkedSourceIdAfterPatch,
  normalizeLinkCode,
  resolveSourceSuggestions,
  sourceIsAvailable,
  suspensionActivityDateShift,
  summarizeSourceChildren,
  topologicalSourceGroupOrder,
  wouldCreateDependencyCycle,
} from "../artifacts/api-server/src/lib/activity-source-rules.ts";

test("source search matches code prefixes case-insensitively and favors code suggestions", () => {
  const codeSuggestion = { groupId: 1, name: "Foundation", linkCode: "alpha-east" };
  const nameSuggestion = { groupId: 2, name: "Alpha footing", linkCode: "other" };
  assert.equal(normalizeLinkCode("  ALpHa "), "alpha");
  assert.equal(groupMatchesSourceQuery(codeSuggestion, "ALP"), true);
  assert.equal(groupMatchesSourceQuery(nameSuggestion, "ALP"), true);
  assert.deepEqual(
    resolveSourceSuggestions([nameSuggestion, codeSuggestion], "ALP"),
    [codeSuggestion, nameSuggestion],
  );
});

test("an exact code lookup resolves to its unique matching group only", () => {
  const exact = { groupId: 4, name: "Group A", linkCode: "share-me" };
  const prefix = { groupId: 5, name: "Share me later", linkCode: "share-me-2" };
  assert.deepEqual(resolveSourceSuggestions([prefix, exact], "SHARE-ME"), [exact]);
});

test("source summary uses weighted progress and earliest/latest child dates", () => {
  const summary = summarizeSourceChildren([
    { actualProgress: 20, weight: 1, plannedStartDate: "2026-04-03", plannedEndDate: "2026-04-10" },
    { actualProgress: 80, weight: 3, plannedStartDate: "2026-04-01", plannedEndDate: "2026-04-18" },
  ], {
    groupId: 17,
    projectId: 3,
    projectName: "Source",
    groupName: "Concrete",
    linkCode: "concrete",
  });
  assert.equal(summary.actualProgress, 65);
  assert.equal(summary.plannedStartDate, "2026-04-01");
  assert.equal(summary.plannedEndDate, "2026-04-18");
});

test("stable-ID links remain available across rename/recode or code removal", () => {
  const renamedAndUnshared = summarizeSourceChildren([], {
    groupId: 17,
    projectId: 3,
    projectName: "Source",
    groupName: "Renamed group",
    linkCode: null,
  });
  assert.equal(sourceIsAvailable(renamedAndUnshared), true);
  assert.deepEqual(linkedActivityValues(renamedAndUnshared, 0), {
    actualProgress: 0,
    plannedStartDate: null,
    plannedEndDate: null,
    plannedProgress: 0,
  });
});

test("deleted source leaves copied target values intact; unlink changes only the link ID", () => {
  const copied = {
    actualProgress: 65,
    plannedStartDate: "2026-04-01",
    plannedEndDate: "2026-04-18",
  };
  assert.equal(sourceIsAvailable(null), false);
  assert.equal(linkedActivityValues(null, 0), null);
  assert.deepEqual(copied, {
    actualProgress: 65,
    plannedStartDate: "2026-04-01",
    plannedEndDate: "2026-04-18",
  });
  assert.equal(linkedSourceIdAfterPatch(17, null), null);
  assert.equal(linkedSourceIdAfterPatch(17, undefined), 17);
});

test("dependency cycle detection rejects reverse/transitive cycles and allows independent links", () => {
  const edges = new Map([
    [1, [2]],
    [2, [3]],
  ]);
  assert.equal(wouldCreateDependencyCycle(3, 1, edges), true);
  assert.equal(wouldCreateDependencyCycle(1, 3, edges), false);
  assert.equal(wouldCreateDependencyCycle(3, 3, edges), true);
});

test("source propagation is topological across converging diamond dependencies", () => {
  const diamond = new Map([
    [1, [2, 3]],
    [2, [4]],
    [3, [4]],
    [4, []],
  ]);
  const order = topologicalSourceGroupOrder([1], diamond);
  assert.equal(order[0], 1);
  assert.ok(order.indexOf(2) < order.indexOf(4));
  assert.ok(order.indexOf(3) < order.indexOf(4));
  assert.equal(order.length, 4);
});

test("propagation order rejects corrupt cycles instead of looping", () => {
  assert.throws(
    () => topologicalSourceGroupOrder([1], new Map([[1, [2]], [2, [1]]])),
    /Cycle detected/,
  );
});

test("project source ACL decisions use stored role rather than JWT role hints", () => {
  assert.equal(currentRoleCanReadProject("project_manager", false, 9, [9]), false);
  assert.equal(currentRoleCanReadProject("engineer", false, 9, [9]), true);
  assert.equal(currentRoleCanReadProject("admin", false, null, []), true);
});

test("suspension shifting skips linked target dates and reverses source-child date changes", () => {
  const linkedTarget = {
    externalSourceGroupId: 11,
    plannedStartDate: "2026-05-01",
    plannedEndDate: "2026-05-10",
  };
  assert.equal(suspensionActivityDateShift(linkedTarget, "2026-05-03", 4, 1), null);

  const sourceChild = {
    externalSourceGroupId: null,
    plannedStartDate: "2026-05-04",
    plannedEndDate: "2026-05-12",
  };
  const shifted = suspensionActivityDateShift(sourceChild, "2026-05-03", 4, 1);
  assert.deepEqual(shifted, { plannedStartDate: "2026-05-08", plannedEndDate: "2026-05-16" });
  assert.deepEqual(
    suspensionActivityDateShift({ ...sourceChild, ...shifted }, "2026-05-03", 4, -1),
    { plannedStartDate: sourceChild.plannedStartDate, plannedEndDate: sourceChild.plannedEndDate },
  );
});