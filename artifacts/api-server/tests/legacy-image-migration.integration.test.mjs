import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { isolatedPostgres } from "../../../tests/helpers/isolated-postgres.mjs";

test("legacy image dry-run and sample migration stay in isolated storage and resume without duplicates", {
  skip: process.env.NODE_ENV !== "development"
    || process.env.REPLIT_DEPLOYMENT === "1"
    || !process.env.IMAGE_AUDIT_BUCKET_ID
    || process.env.IMAGE_AUDIT_BUCKET_ID === process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
  timeout: 180_000,
}, async () => {
  const postgres = await isolatedPostgres();
  let schema, bucketClient, sourceObject, projectId, projectFileId, restoreBucket, evidence;
  const createdObjectNames = new Set();
  const cleanupResult = { attempted: 0, deleteFailures: 0, stillPresent: 0, verifiedAbsent: 0 };
  const bucketId = process.env.IMAGE_AUDIT_BUCKET_ID;
  try {
    [schema, bucketClient] = await Promise.all([
      import("../../../lib/db/src/index.ts"),
      import("../src/lib/objectStorage.ts"),
    ]);
    const { db, projectsTable, projectFilesTable, imageAssetsTable, pool } = schema;
    const storage = bucketClient.objectStorageClient;
    const originalBucket = storage.bucket.bind(storage);
    restoreBucket = () => { storage.bucket = originalBucket; };
    storage.bucket = (requestedId, ...args) => {
      assert.equal(requestedId, bucketId, "test refused a non-audit object-storage bucket");
      return originalBucket(requestedId, ...args);
    };
    const bucket = storage.bucket(bucketId);
    const tag = randomUUID();
    const filename = `legacy-migration-test-${tag}.jpg`;
    sourceObject = `uploads/${filename}`;

    const [{ default: sharp }, { createLegacyImageMigration }] = await Promise.all([
      import("sharp"),
      import("../src/lib/legacy-image-migration.ts"),
    ]);
    const jpeg = await sharp({
      create: { width: 720, height: 480, channels: 3, background: { r: 80, g: 110, b: 130 } },
    }).jpeg({ quality: 94 }).toBuffer();
    const sourceFile = bucket.file(sourceObject);
    await sourceFile.save(jpeg, {
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
    });
    createdObjectNames.add(sourceObject);
    const [sourceMetadataBefore] = await sourceFile.getMetadata();

    const [project] = await db.insert(projectsTable).values({
      name: "Legacy image migration isolated fixture",
      location: "isolated",
      contractor: "fixture",
      ownerEntity: "fixture",
      supervisorEntity: "fixture",
      startDate: "2026-01-01",
      expectedEndDate: "2029-12-31",
    }).returning();
    projectId = project.id;
    const [projectFile] = await db.insert(projectFilesTable).values({
      projectId,
      filename,
      originalName: "synthetic.jpg",
      category: "image",
      fileUrl: `/api/uploads/${filename}`,
      fileSize: jpeg.length,
      mimeType: "image/jpeg",
      description: "Isolated migration fixture",
    }).returning();
    projectFileId = projectFile.id;

    const migration = createLegacyImageMigration({ bucketId });
    const beforeCount = await db.select().from(imageAssetsTable);
    let startedAt = performance.now();
    const dryRun = await migration.inspectPage({ projectId, limit: 5, profile: "file_image" });
    const dryRunMs = performance.now() - startedAt;
    assert.equal(dryRun.counts.candidate, 1);
    assert.equal(dryRun.items[0].filename, filename);
    assert.equal(dryRun.duplicates.length, 0);
    assert.equal((await db.select().from(imageAssetsTable)).length, beforeCount.length,
      "dry-run must not write image lifecycle rows");

    startedAt = performance.now();
    const migrated = await migration.migratePage({ projectId, limit: 1, profile: "file_image" });
    const migrationMs = performance.now() - startedAt;
    assert.equal(migrated.results[0].status, "ready");
    assert.equal(migrated.results[0].sourceFileUrlUnchanged, true);
    const [asset] = await db.select().from(imageAssetsTable)
      .where(eq(imageAssetsTable.projectFileId, projectFileId));
    assert.equal(asset.state, "ready");
    assert.equal(asset.storageBucket, bucketId);
    assert.equal(asset.profile, "file_image");
    assert.ok(asset.storageKey && asset.thumbnailKey);
    assert.equal(asset.printKey, null);

    const after = await db.select().from(projectFilesTable)
      .where(eq(projectFilesTable.id, projectFileId));
    assert.equal(after[0].filename, filename);
    assert.equal(after[0].fileUrl, `/api/uploads/${filename}`);
    const rollback = await migration.rollbackMap(projectId, "file_image");
    assert.equal(rollback.length, 1);
    assert.equal(rollback[0].sourceFilename, filename);
    assert.equal(rollback[0].referenceChanged, false);
    assert.equal(rollback[0].originalObjectKept, true);
    for (const objectName of rollback[0].destinationNames) {
      createdObjectNames.add(`uploads/${objectName}`);
      assert.equal((await bucket.file(`uploads/${objectName}`).exists())[0], true);
    }

    startedAt = performance.now();
    const resumed = await migration.migratePage({ projectId, limit: 1, profile: "file_image" });
    const resumeMs = performance.now() - startedAt;
    assert.equal(resumed.results[0].status, "already_managed");
    assert.equal((await db.select().from(imageAssetsTable))
      .filter(row => row.projectFileId === projectFileId && row.profile === "file_image").length, 1);
    const [sourceMetadataAfter] = await sourceFile.getMetadata();
    assert.equal(sourceMetadataAfter.generation, sourceMetadataBefore.generation);
    evidence = {
      recordedAt: new Date().toISOString(),
      status: "PASS",
      environment: "development",
      storage: "isolated audit bucket only",
      database: "fresh private PostgreSQL cluster",
      scope: "one synthetic project-file image; no existing development or production rows",
      dryRun: { status: "PASS_READ_ONLY", candidates: 1, existingImageAssetRows: beforeCount.length, elapsedMs: dryRunMs },
      sample: {
        status: "PASS", images: 1, profile: "file_image", state: asset.state,
        sourceBytes: jpeg.length, outputBytes: asset.byteSize, dimensions: [asset.width, asset.height],
        durableObjectsVerified: rollback[0].destinationNames.length,
        elapsedMs: migrationMs,
      },
      recovery: {
        status: "PASS", resumedAs: resumed.results[0].status, imageAssetRows: 1,
        originalGenerationUnchanged: sourceMetadataAfter.generation === sourceMetadataBefore.generation,
        originalObjectRetained: rollback[0].originalObjectKept,
        projectFileReferenceChanged: rollback[0].referenceChanged,
        rollbackMappingEntries: rollback.length,
        elapsedMs: resumeMs,
      },
    };
  } finally {
    const storage = bucketClient?.objectStorageClient;
    if (storage && bucketId) {
      if (schema && projectId) {
        try {
          const assets = await schema.db.select({
            storageKey: schema.imageAssetsTable.storageKey,
            thumbnailKey: schema.imageAssetsTable.thumbnailKey,
            printKey: schema.imageAssetsTable.printKey,
          }).from(schema.imageAssetsTable)
            .where(eq(schema.imageAssetsTable.projectId, projectId));
          for (const asset of assets) {
            for (const key of [asset.storageKey, asset.thumbnailKey, asset.printKey]) {
              if (key) createdObjectNames.add(key);
            }
          }
        } catch { /* the isolated cluster may already have stopped */ }
      }
      const bucket = storage.bucket(bucketId);
      for (const objectName of createdObjectNames) {
        const key = objectName.startsWith("uploads/") ? objectName : `uploads/${objectName}`;
        const file = bucket.file(key);
        cleanupResult.attempted++;
        try { await file.delete({ ignoreNotFound: true }); }
        catch { cleanupResult.deleteFailures++; }
        try {
          const [exists] = await file.exists();
          if (exists) cleanupResult.stillPresent++;
          else cleanupResult.verifiedAbsent++;
        } catch { cleanupResult.deleteFailures++; }
      }
      restoreBucket?.();
    }
    if (evidence) {
      evidence.cleanup = {
        ...cleanupResult,
        status: cleanupResult.deleteFailures === 0 && cleanupResult.stillPresent === 0 ? "PASS" : "FAIL",
        scope: "only exact synthetic source and managed object keys created by this test",
      };
      const outputDir = resolve("generated-artifacts/image-audit");
      await mkdir(outputDir, { recursive: true });
      await writeFile(resolve(outputDir, "legacy-sample-validation.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      assert.equal(evidence.cleanup.status, "PASS", "synthetic storage cleanup must be verified");
    }
    if (schema?.pool) await schema.pool.end().catch(() => {});
    await postgres.stop();
  }
});
