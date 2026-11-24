import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
const realRequire = createRequire(new URL("../package.json", import.meta.url));
const entryPoint = fileURLToPath(new URL("../src/lib/image-read-reference.ts", import.meta.url));
const bundle = await build({
  entryPoints: [entryPoint],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
});

const uuid = "11111111-2222-4333-8444-555555555555";
const attempt = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const primaryKey = `uploads/image-${uuid}-${attempt}.webp`;
const thumbnailKey = `uploads/image-${uuid}-${attempt}-thumb.webp`;
const printKey = `uploads/image-${uuid}-${attempt}-print.jpg`;
const table = { storageKey: "image_assets.storage_key" };
let activeAsset;
const database = {
  select: () => ({
    from: selectedTable => {
      assert.equal(selectedTable, table);
      return {
        where: condition => {
          assert.deepEqual(condition, { column: table.storageKey, value: primaryKey });
          return { limit: async () => [activeAsset] };
        },
      };
    },
  }),
};
const mockedRequire = id => {
  if (id === "@workspace/db") return { db: database, imageAssetsTable: table };
  if (id === "drizzle-orm") return { eq: (column, value) => ({ column, value }) };
  return realRequire(id);
};
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  mockedRequire,
  module,
  module.exports,
);
const { resolveStoredImageForRead } = module.exports;

function asset(profile, printState = "ready") {
  return {
    id: uuid,
    projectId: 7,
    storageKey: primaryKey,
    thumbnailKey,
    printKey,
    storageBucket: "isolated-audit-bucket",
    profile,
    state: "ready",
    primaryState: "ready",
    thumbnailState: "ready",
    printState,
    mimeType: "image/webp",
  };
}

test("report reads use prepared print variants for every report image profile", async () => {
  for (const profile of ["report", "report_detail", "report_technical", "file_image"]) {
    activeAsset = asset(profile);
    const result = await resolveStoredImageForRead(primaryKey.split("/").at(-1), "report", 7);
    assert.equal(result.kind, "ready", profile);
    assert.equal(result.storageKey, printKey, profile);
    assert.equal(result.filename, printKey.split("/").at(-1), profile);
    assert.equal(result.mimeType, "image/jpeg", profile);
  }
});

test("report reads fail explicitly instead of falling back when a required print variant is incomplete", async () => {
  activeAsset = asset("report_technical", "failed");
  const result = await resolveStoredImageForRead(primaryKey.split("/").at(-1), "report", 7);
  assert.deepEqual(result, { kind: "missing_derivative", imageId: uuid });
});
