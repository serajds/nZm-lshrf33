import fs from "node:fs";
import path from "node:path";
import { asc, and, eq, inArray } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  projectFilesTable,
  reportsTable,
} from "@workspace/db";
import { deleteFromCloudStrict } from "./fileStorage";
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

  const filenames = await db.transaction(async tx => {
    const ownedFiles = await tx.select({ filename: projectFilesTable.filename })
      .from(projectFilesTable)
      .where(and(
        eq(projectFilesTable.projectId, projectId),
        eq(projectFilesTable.category, "image"),
        inArray(projectFilesTable.filename, requestedFilenames),
      ))
      .for("update");
    const ownedNames = [...new Set(ownedFiles.map(file => file.filename))];
    if (ownedNames.length === 0) return [];

    const attendanceFiles = await tx.select({ filename: attendanceRecordsTable.selfieFilename })
      .from(attendanceRecordsTable)
      .where(inArray(attendanceRecordsTable.selfieFilename, ownedNames));
    const attendanceNames = new Set(attendanceFiles
      .map(file => file.filename)
      .filter((filename): filename is string => typeof filename === "string"));
    const deletableNames = ownedNames.filter(filename => !attendanceNames.has(filename));
    if (deletableNames.length === 0) return [];
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

    return deletableNames;
  });

  if (filenames.length === 0) return 0;
  const deletionResults = await Promise.allSettled(filenames.map(async filename => {
    await fs.promises.unlink(path.join(reportUploadsDir, filename)).catch(() => {});
    await deleteFromCloudStrict(filename);
    await deleteStoredReportImageVariants(filename, reportUploadsDir);
  }));
  const failed = deletionResults.filter(result => result.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Could not delete ${failed.length} report image file(s) from storage`);
  }

  await db.delete(projectFilesTable).where(inArray(projectFilesTable.filename, filenames));
  return filenames.length;
}
