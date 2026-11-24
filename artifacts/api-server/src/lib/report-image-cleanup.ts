import fs from "node:fs";
import path from "node:path";
import { asc, and, eq, inArray } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  imageAssetsTable,
  projectFilesTable,
  reportsTable,
} from "@workspace/db";
import { deleteFromCloudStrict, deleteImageObjectStrict } from "./fileStorage";
import { imageObjectName } from "./image-asset-keys";
import { reportUploadFilenames } from "./report-preview-assets";
import { deleteStoredReportImageVariants } from "./reportImageVariantStorage";

const reportUploadsDir = path.join(process.cwd(), "uploads");

type ImageGroupValue = {
  category: string;
  urls?: unknown;
  [key: string]: unknown;
};

/**
 * Remove selected report images from report references and project file
 * records, then delete their local, cloud, and generated variant files.
 * This is intentionally global for filenames so duplicated reports do not
 * retain broken references after the owner confirms permanent deletion.
 */
export async function permanentlyDeleteReportImages(
  projectId: number,
  imageUrls: readonly string[],
): Promise<number> {
  const requestedFilenames = reportUploadFilenames(imageUrls);
  if (requestedFilenames.length === 0) return 0;

  const { filenames, managedAssets, filenameByFileId } = await db.transaction(async tx => {
    const ownedFiles = await tx.select({ id: projectFilesTable.id, filename: projectFilesTable.filename })
      .from(projectFilesTable)
      .where(and(
        eq(projectFilesTable.projectId, projectId),
        eq(projectFilesTable.category, "image"),
        inArray(projectFilesTable.filename, requestedFilenames),
      ))
      .for("update");
    const ownedNames = [...new Set(ownedFiles.map(file => file.filename))];
    if (ownedNames.length === 0) return { filenames: [], managedAssets: [], filenameByFileId: new Map<number, string>() };

    const attendanceFiles = await tx.select({ filename: attendanceRecordsTable.selfieFilename })
      .from(attendanceRecordsTable)
      .where(inArray(attendanceRecordsTable.selfieFilename, ownedNames));
    const attendanceNames = new Set(attendanceFiles
      .map(file => file.filename)
      .filter((filename): filename is string => typeof filename === "string"));
    const deletableNames = ownedNames.filter(filename => !attendanceNames.has(filename));
    if (deletableNames.length === 0) return { filenames: [], managedAssets: [], filenameByFileId: new Map<number, string>() };
    const deletable = new Set(deletableNames);
    const hasDeletableFile = (url: unknown) =>
      typeof url === "string" && reportUploadFilenames([url]).some(filename => deletable.has(filename));

    const reports = await tx.select({
      id: reportsTable.id,
      imageUrls: reportsTable.imageUrls,
      imageGroups: reportsTable.imageGroups,
    }).from(reportsTable)
      .orderBy(asc(reportsTable.id))
      .for("update");

    for (const report of reports) {
      const imageUrls = Array.isArray(report.imageUrls)
        ? report.imageUrls.filter(url => !hasDeletableFile(url))
        : [];
      const imageGroups = Array.isArray(report.imageGroups)
        ? (report.imageGroups as ImageGroupValue[]).map(group => ({
            ...group,
            urls: Array.isArray(group.urls) ? group.urls.filter(url => !hasDeletableFile(url)) : [],
          }))
        : report.imageGroups;
      if (JSON.stringify(imageUrls) !== JSON.stringify(report.imageUrls)
        || JSON.stringify(imageGroups) !== JSON.stringify(report.imageGroups)) {
        await tx.update(reportsTable)
          .set({ imageUrls, imageGroups })
          .where(eq(reportsTable.id, report.id));
      }
    }

    const deletableFileIds = ownedFiles.filter(file => deletable.has(file.filename)).map(file => file.id);
    const filenameByFileId = new Map(ownedFiles
      .filter(file => deletable.has(file.filename))
      .map(file => [file.id, file.filename] as const));
    const managedAssets = await tx.select({
      id: imageAssetsTable.id,
      projectFileId: imageAssetsTable.projectFileId,
      storageBucket: imageAssetsTable.storageBucket,
      storageKey: imageAssetsTable.storageKey,
      thumbnailKey: imageAssetsTable.thumbnailKey,
      printKey: imageAssetsTable.printKey,
    }).from(imageAssetsTable)
      .where(and(
        inArray(imageAssetsTable.projectFileId, deletableFileIds),
        inArray(imageAssetsTable.projectId, [projectId]),
      ));
    return { filenames: deletableNames, managedAssets, filenameByFileId };
  });

  if (filenames.length === 0) return 0;
  const managedByFilename = new Map<string, (typeof managedAssets)[number] | null>();
  for (const asset of managedAssets) {
    const filename = asset.projectFileId === null ? undefined : filenameByFileId.get(asset.projectFileId);
    if (!filename) continue;
    try {
      if (!asset.storageKey) throw new Error("managed_image_key_missing");
      if (imageObjectName(asset.storageKey) !== filename) throw new Error("managed_image_reference_mismatch");
      managedByFilename.set(filename, asset);
    } catch {
      managedByFilename.set(filename, null);
    }
  }
  const deletionResults = await Promise.allSettled(filenames.map(async filename => {
    const asset = managedByFilename.get(filename);
    if (managedByFilename.has(filename)) {
      if (!asset) throw new Error("managed_image_reference_invalid");
      if (!asset.storageBucket) throw new Error("managed_image_bucket_missing");
      const keys = [...new Set([asset.storageKey, asset.thumbnailKey, asset.printKey].filter((key): key is string => !!key))];
      for (const key of keys) {
        const objectName = imageObjectName(key);
        await fs.promises.unlink(path.join(reportUploadsDir, objectName)).catch(() => {});
        await deleteImageObjectStrict(objectName, asset.storageBucket);
      }
      return;
    }
    await fs.promises.unlink(path.join(reportUploadsDir, filename)).catch(() => {});
    await deleteFromCloudStrict(filename);
    await deleteStoredReportImageVariants(filename, reportUploadsDir);
  }));
  const failed = deletionResults.filter(result => result.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Could not delete ${failed.length} report image file(s) from storage`);
  }

  await db.transaction(async tx => {
    const assetIds = managedAssets.map(asset => asset.id);
    if (assetIds.length) await tx.delete(imageAssetsTable).where(inArray(imageAssetsTable.id, assetIds));
    await tx.delete(projectFilesTable).where(inArray(projectFilesTable.filename, filenames));
  });
  return filenames.length;
}
