// Development-only, page-bounded legacy image inventory and opt-in sample.
// Default mode is read-only. This tool never reads the default storage bucket,
// changes historical URLs, or deletes originals/derived objects.
import assert from "node:assert/strict";

assert.equal(process.env.NODE_ENV, "development", "Run only in development");
assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1", "Deployed environments are blocked");
assert.ok(process.env.IMAGE_AUDIT_BUCKET_ID, "IMAGE_AUDIT_BUCKET_ID must identify isolated development storage");
assert.notEqual(
  process.env.IMAGE_AUDIT_BUCKET_ID,
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
  "The audit bucket must differ from the default object-storage bucket",
);

const options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key?.startsWith("--")) throw new Error("Invalid option");
  if (key === "--dry-run") options.set("dry-run", true);
  else if (["--project", "--after", "--profile", "--sample"].includes(key)) {
    const value = process.argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options.set(key.slice(2), value);
  } else throw new Error(`Unsupported option: ${key}`);
}

const projectId = Number(options.get("project"));
const afterId = Number(options.get("after") ?? 0);
const profile = options.get("profile") ?? "file_image";
const sampleCount = options.has("sample") ? Number(options.get("sample")) : null;
if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("Provide a positive --project id");
if (!Number.isSafeInteger(afterId) || afterId < 0) throw new Error("Invalid --after cursor");
if (!["file_image", "report"].includes(profile)) throw new Error("Profile must be file_image or report");
if (sampleCount !== null && (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 3)) {
  throw new Error("--sample is limited to 1–3 images per run");
}
if (options.has("dry-run") && sampleCount !== null) throw new Error("Choose --dry-run or --sample, not both");

const [{ createLegacyImageMigration }, { pool }] = await Promise.all([
  import("../../artifacts/api-server/src/lib/legacy-image-migration.ts"),
  import("../../lib/db/src/index.ts"),
]);
try {
  const migration = createLegacyImageMigration();
  const result = sampleCount === null
    ? await migration.inspectPage({ projectId, afterId, limit: 50, profile })
    : await migration.migratePage({ projectId, afterId, limit: sampleCount, profile });
  const rollback = sampleCount === null ? undefined : await migration.rollbackMap(projectId, profile);
  console.log(JSON.stringify({
    mode: sampleCount === null ? "dry_run" : "sample_migration",
    sourceAndDestination: "isolated_development_bucket",
    referencesChanged: false,
    originalsDeleted: false,
    ...result,
    ...(rollback ? { rollbackMap: rollback } : {}),
  }, null, 2));
} finally {
  await pool.end();
}
