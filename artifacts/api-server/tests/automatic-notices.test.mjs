import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = new URL("../../construction-supervision/", import.meta.url);
const built = await build({
  entryPoints: [fileURLToPath(new URL("src/lib/automatic-notices.ts", webRoot))],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { AutomaticNoticeQueue, ElapsedCountdown } =
  await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("automatic notices show FIFO with no preemption or duplicate entries", () => {
  const queue = new AutomaticNoticeQueue();
  queue.request("quick-view");
  queue.request("reminder");
  queue.request("quick-view");
  assert.equal(queue.getActive(), "quick-view");
  queue.release("quick-view");
  assert.equal(queue.getActive(), "reminder");
  queue.release("reminder");
  assert.equal(queue.getActive(), null);
});

test("unmounting a waiting notice does not close the active one; account reset clears all notices", () => {
  const queue = new AutomaticNoticeQueue();
  const active = [];
  const unsubscribe = queue.subscribe(() => active.push(queue.getActive()));
  queue.request("reminder");
  queue.request("quick-view");
  queue.release("quick-view");
  assert.equal(queue.getActive(), "reminder");
  queue.clear();
  assert.equal(queue.getActive(), null);
  assert.equal(active.at(-1), null);
  unsubscribe();
  const count = active.length;
  queue.request("another-account-notice");
  assert.equal(active.length, count);
});

test("elapsed time, not callback frequency, controls expiration", () => {
  let now = 0;
  const timer = new ElapsedCountdown(10000, () => now);
  timer.resume();
  now = 9500;
  assert.equal(timer.remaining(), 500);
  now = 20000;
  assert.equal(timer.remaining(), 0);
});

test("hover/focus/visibility pauses preserve the remaining budget; reset restores ten seconds", () => {
  let now = 0;
  const timer = new ElapsedCountdown(10000, () => now);
  timer.resume();
  now = 2500;
  timer.pause();
  timer.pause();
  now = 90000;
  assert.equal(timer.remaining(), 7500);
  timer.resume();
  timer.resume();
  now = 92000;
  assert.equal(timer.remaining(), 5500);
  timer.reset();
  assert.equal(timer.remaining(), 10000);
  now += 100000;
  assert.equal(timer.remaining(), 10000);
});

function findNode(source, predicate) {
  let match;
  function visit(node) {
    if (!match && predicate(node)) match = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(match, "Expected production code node");
  return match;
}
function transpile(code) {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

test("actual countdown hook waits for visibility, cleans intervals, pauses and expires after a delayed tick", () => {
  const source = ts.createSourceFile("notices.tsx",
    readFileSync(new URL("src/components/automatic-notices.tsx", webRoot), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hook = findNode(source, node => ts.isFunctionDeclaration(node) && node.name?.text === "useAutoCloseCountdown");
  const hookCode = hook.getText(source).replace(/^export /, "");
  let now = 0, cursor = 0, effects = [], intervals = new Map(), serial = 0, expired = 0;
  const slots = [];
  const context = vm.createContext({
    ElapsedCountdown: class extends ElapsedCountdown { constructor(duration) { super(duration, () => now); } },
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
    useRef: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect: (callback, deps) => {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: callback() };
        });
      }
    },
    window: {
      setInterval: callback => { intervals.set(++serial, callback); return serial; },
      clearInterval: id => intervals.delete(id),
    },
  });
  vm.runInContext(transpile(hookCode), context);
  const render = (visible, paused) => {
    cursor = 0;
    effects = [];
    context.useAutoCloseCountdown(visible, paused, () => { expired++; }, 10000);
    effects.forEach(run => run());
  };
  render(false, false);
  now = 50000; // Time in the notice queue consumes none of the countdown.
  assert.equal(slots[0], 10000);
  assert.equal(intervals.size, 0);
  render(true, false);
  assert.equal(intervals.size, 1);
  now = 52500;
  [...intervals.values()].forEach(tick => tick());
  assert.equal(slots[0], 7500);
  render(true, true);
  assert.equal(intervals.size, 0);
  now = 100000;
  render(true, false);
  assert.equal(slots[0], 7500);
  now = 110000; // A heavily delayed callback must still expire immediately.
  [...intervals.values()].forEach(tick => tick());
  assert.equal(slots[0], 0);
  assert.equal(expired, 1);
  assert.equal(intervals.size, 0);
  render(false, false);
  assert.equal(slots[0], 10000);
});

test("a claimed but unseen reminder survives navigation without another server claim", async () => {
  const source = ts.createSourceFile("reminder.tsx",
    readFileSync(new URL("src/components/project-activity-reminder.tsx", webRoot), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = findNode(source, node => ts.isPropertyAssignment(node) && node.name.getText(source) === "queryFn");
  let pending;
  let claims = 0;
  const key = ["project-activity-reminder", 1, 2, "2026-10-31"];
  const load = vm.runInNewContext(transpile(`(${fn.initializer.getText(source)})`), {
    queryKey: key, projectId: 2,
    queryClient: { getQueryData: actualKey => { assert.equal(actualKey, key); return pending; } },
    customFetch: async () => {
      claims++;
      pending = { show: true, fullName: "Synthetic", lastUpdatedAt: null };
      return pending;
    },
  });
  const claimed = await load();
  assert.deepEqual(claimed, pending);
  assert.equal(claims, 1);
  assert.deepEqual(await load(), claimed);
  assert.equal(claims, 1);
  pending = { show: false };
  assert.equal((await load()).show, false);
  assert.equal(claims, 1);
});

test("both dialog roots use the shared slot; keyboard and visibility interaction pause the quick-view timer", () => {
  const quick = readFileSync(new URL("src/components/project-quick-view-dialog.tsx", webRoot), "utf8");
  const reminder = readFileSync(new URL("src/components/project-activity-reminder.tsx", webRoot), "utf8");
  assert.match(quick, /Root open=\{visible\}/);
  assert.match(reminder, /Dialog open=\{visible\}/);
  assert.match(quick, /onKeyDownCapture=\{\(\) => setKeyboardFocus\(true\)\}/);
  assert.match(quick, /onBlurCapture=/);
  assert.match(quick, /hovered \|\| keyboardFocus \|\| hidden/);
  assert.match(quick, /removeEventListener\("visibilitychange"/);
  assert.match(reminder, /reminder\.projectId === projectId/);
  assert.match(reminder, /reminder\.userId === user\?\.id/);
  assert.match(reminder, /reminder\.day === day/);
});
