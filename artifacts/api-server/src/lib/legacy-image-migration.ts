import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, imageAssetsTable, projectFilesTable } from "@workspace/db";
import { IMAGE_SOURCE_MAX_BYTES, type ImageProfile } from "@workspace/api-zod";
import { objectStorageClient } from "./objectStorage";
import { createImageLifecycle } from "./image-lifecycle";
import { imageObjectName, UPLOADS_PREFIX } from "./image-asset-keys";
import { ImageProcessingError } from "./image-processing";

type MigrationProfile = Extract<ImageProfile, "file_image" | "report">;
type LegacyFile = {
  id: number;
  projectId: number;
  filename: string;
  fileSize: number;
  mimeType: string | null;
};

function auditBucket(): string {
  const bucketId = process.env.IMAGE_AUDIT_BUCKET_ID;
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1"
    || !bucketId || bucketId === process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
    throw new Error("isolated_development_bucket_required");
  }
  return bucketId;
}

function safePageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("invalid_migration_page_size");
  return value;
}

function safeFilename(filename: string): string {
  if (!filename || path.basename(filename) !== filename || filename.includes("\\")) {
    throw new Error("invalid_legacy_image_filename");
  }
  return filename;
}

function migrationIdentity(file: LegacyFile, profile: MigrationProfile, bucketId: string) {
  const bucketHash = createHash("sha256").update(bucketId).digest("hex").slice(0, 16);
  return {
    scope: `audit:${bucketHash}:project:${file.projectId}:${profile}`,
    clientKey: `legacy-file-${file.id}-${profile}`,
  };
}

export function createLegacyImageMigration(options: {
  bucketId?: string;
  lifecycle?: ReturnType<typeof createImageLifecycle>;
} = {}) {
  const bucketId = options.bucketId ?? auditBucket();
  if (bucketId !== auditBucket()) throw new Error("isolated_development_bucket_required");
  const lifecycle = options.lifecycle ?? createImageLifecycle({ bucketId });
  const bucket = objectStorageClient.bucket(bucketId);

  async function inspectPage(input: {
    projectId: number;
    afterId?: number;
    limit?: number;
    profile?: MigrationProfile;
  }) {
    const limit = safePageSize(input.limit ?? 20);
    const profile = input.profile ?? "file_image";
    const afterId = input.afterId ?? 0;
    if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0 || !Number.isSafeInteger(afterId) || afterId < 0) {
      throw new Error("invalid_migration_cursor");
    }
    const rows = await db.select({
      id: projectFilesTable.id,
      projectId: projectFilesTable.projectId,
      filename: projectFilesTable.filename,
      fileSize: projectFilesTable.fileSize,
      mimeType: projectFilesTable.mimeType,
    }).from(projectFilesTable)
      .where(and(
        eq(projectFilesTable.projectId, input.projectId),
        eq(projectFilesTable.category, "image"),
        gt(projectFilesTable.id, afterId),
      ))
      .orderBy(asc(projectFilesTable.id))
      .limit(limit);
    const ids = rows.map(row => row.id);
    const existing = ids.length ? await db.select({
      projectFileId: imageAssetsTable.projectFileId,
      state: imageAssetsTable.state,
      profile: imageAssetsTable.profile,
      storageBucket: imageAssetsTable.storageBucket,
      storageKey: imageAssetsTable.storageKey,
      thumbnailKey: imageAssetsTable.thumbnailKey,
      printKey: imageAssetsTable.printKey,
    }).from(imageAssetsTable).where(inArray(imageAssetsTable.projectFileId, ids)) : [];
    const existingByFile = new Map<number, typeof existing>();
    for (const asset of existing) {
      if (asset.projectFileId === null) continue;
      const assets = existingByFile.get(asset.projectFileId) ?? [];
      assets.push(asset);
      existingByFile.set(asset.projectFileId, assets);
    }
    const duplicateByHash = new Map<string, string[]>();
    const items = [];
    for (const row of rows) {
      const filename = safeFilename(row.filename);
      const file = bucket.file(`${UPLOADS_PREFIX}${filename}`);
      try {
        const [metadata] = await file.getMetadata();
        const size = Number(metadata.size);
        const md5Hash = typeof metadata.md5Hash === "string" ? metadata.md5Hash : null;
        if (md5Hash) duplicateByHash.set(md5Hash, [...(duplicateByHash.get(md5Hash) ?? []), filename]);
        const current = existingByFile.get(row.id) ?? [];
        const matchingAssets = current.filter(asset => asset.profile === profile && asset.storageBucket === bucketId);
        let alreadyManaged = false;
        let incompleteManaged = false;
        for (const asset of matchingAssets) {
          if (asset.state !== "ready" || !asset.storageKey) continue;
          const expectedKeys = [
            asset.storageKey,
            ...(profile === "report" ? [asset.thumbnailKey, asset.printKey] : [asset.thumbnailKey]),
          ].filter((key): key is string => !!key);
          if (expectedKeys.length !== (profile === "report" ? 3 : 2)) {
            incompleteManaged = true;
            continue;
          }
          const exists = await Promise.all(expectedKeys.map(key => bucket.file(key).exists().then(([found]) => found)));
          if (exists.every(Boolean)) alreadyManaged = true;
          else incompleteManaged = true;
        }
        items.push({
          id: row.id, filename, fileSize: Number.isFinite(size) ? size : row.fileSize,
          sourceMimeType: metadata.contentType ?? row.mimeType,
          generation: String(metadata.generation ?? ""),
          status: alreadyManaged ? "already_managed" as const
            : incompleteManaged ? "incomplete_managed_asset" as const
            : !Number.isFinite(size) || size < 1 ? "invalid_size" as const
              : size > IMAGE_SOURCE_MAX_BYTES ? "too_large" as const : "candidate" as const,
        });
      } catch (error) {
        if ((error as { code?: number }).code === 404) {
          items.push({ id: row.id, filename, fileSize: row.fileSize, sourceMimeType: row.mimeType, generation: "", status: "missing_object" as const });
        } else throw error;
      }
    }
    const duplicates = [...duplicateByHash.entries()]
      .filter(([, filenames]) => filenames.length > 1)
      .map(([hash, filenames]) => ({ hash, filenames }));
    return {
      projectId: input.projectId, profile, storageScope: "isolated_development_bucket", afterId,
      nextCursor: rows.length === limit ? rows.at(-1)!.id : null,
      items, duplicates,
      counts: items.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {} as Record<string, number>),
    };
  }

  async function migratePage(input: {
    projectId: number;
    afterId?: number;
    limit?: number;
    profile?: MigrationProfile;
  }) {
    const page = await inspectPage(input);
    const profile = page.profile as MigrationProfile;
    const results = [];
    for (const item of page.items) {
      if (item.status !== "candidate") {
        results.push({ filename: item.filename, status: item.status });
        continue;
      }
      const sourceFile = bucket.file(`${UPLOADS_PREFIX}${item.filename}`, {
        generation: item.generation || undefined,
      });
      const [bytes] = await sourceFile.download();
      if (bytes.length < 1 || bytes.length > IMAGE_SOURCE_MAX_BYTES) {
        results.push({ filename: item.filename, status: "source_size_changed" });
        continue;
      }
      const temporary = await mkdtemp(path.join(os.tmpdir(), "legacy-image-migration-"));
      const sourcePath = path.join(temporary, "source");
      try {
        await writeFile(sourcePath, bytes, { flag: "wx" });
        const file: LegacyFile = {
          id: item.id, projectId: input.projectId, filename: item.filename,
          fileSize: item.fileSize, mimeType: item.sourceMimeType,
        };
        const identity = migrationIdentity(file, profile, bucketId);
        const ready = await lifecycle.upload({
          principal: "legacy-image-migration",
          authorizedScope: identity.scope,
          clientKey: identity.clientKey,
          userId: null, projectId: input.projectId, profile, sourcePath,
          onCommit: async () => file.id,
        });
        results.push({
          filename: item.filename, status: "ready", imageId: ready.image.id,
          sourceFileUrlUnchanged: true, originalObjectRetained: true,
        });
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    return { ...page, results };
  }

  async function rollbackMap(projectId: number, profile: MigrationProfile = "file_image") {
    if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("invalid_project_id");
    const bucketHash = createHash("sha256").update(bucketId).digest("hex").slice(0, 16);
    const scope = `legacy-image-migration:audit:${bucketHash}:project:${projectId}:${profile}`;
    const rows = await db.select({
      imageId: imageAssetsTable.id,
      projectFileId: imageAssetsTable.projectFileId,
      state: imageAssetsTable.state,
      storageKey: imageAssetsTable.storageKey,
      thumbnailKey: imageAssetsTable.thumbnailKey,
      printKey: imageAssetsTable.printKey,
      sourceFileUrl: projectFilesTable.fileUrl,
      sourceFilename: projectFilesTable.filename,
    }).from(imageAssetsTable)
      .leftJoin(projectFilesTable, eq(imageAssetsTable.projectFileId, projectFilesTable.id))
      .where(and(
        eq(imageAssetsTable.scope, scope),
        eq(imageAssetsTable.projectId, projectId),
      ));
    return rows.map(row => ({
      ...row,
      destinationNames: [row.storageKey, row.thumbnailKey, row.printKey].filter((key): key is string => !!key).map(imageObjectName),
      originalObjectKept: true,
      referenceChanged: false,
    }));
  }

  return { inspectPage, migratePage, rollbackMap };
}
