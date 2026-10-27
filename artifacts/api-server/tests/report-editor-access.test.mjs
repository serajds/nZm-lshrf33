import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "reports.tsx",
  readFileSync(new URL("../../construction-supervision/src/pages/projects/[id]/reports.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const elements = [];
function visit(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
const tag = node => (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(source);
function guards(node) {
  const result = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      result.push(parent.left.getText(source));
    }
  }
  return result;
}

test("report editor is mounted for report editors, not restricted to approvers", () => {
  const dialog = elements.find(node => tag(node) === "Dialog" &&
    node.getText(source).includes("open={isDialogOpen}"));
  assert.ok(dialog);
  assert.ok(guards(dialog).includes("canEditReports"));
  assert.ok(!guards(dialog).includes("canApprove"));
});

test("report settings retain the separate approver restriction", () => {
  const settings = elements.find(node => tag(node) === "ReportSettingsDialog");
  assert.ok(settings);
  assert.ok(guards(settings).includes("canApprove"));
});
