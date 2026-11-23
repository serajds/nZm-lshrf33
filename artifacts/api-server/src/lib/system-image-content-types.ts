import { and, desc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { db, systemImageCompressionItemsTable } from "@workspace/db";
import path from "node:path";

const contentTypes = new Map<string, string>();

export async function loadSystemImageContentTypes(): Promise<void> {
  const rows = await db.select({
    filename: systemImageCompressionItemsTable.filename,
    outputMimeType: systemImageCompressionItemsTable.outputMimeType,
  }).from(systemImageCompressionItemsTable)
    .where(and(
      eq(systemImageCompressionItemsTable.status, "compressed"),
      isNotNull(systemImageCompressionItemsTable.outputMimeType),
      or(
        ilike(systemImageCompressionItemsTable.filename, "%.heic"),
        ilike(systemImageCompressionItemsTable.filename, "%.heif"),
      ),
    ))
    .orderBy(desc(systemImageCompressionItemsTable.updatedAt));
  contentTypes.clear();
  for (const row of rows) {
    if (row.outputMimeType && !contentTypes.has(row.filename)) {
      contentTypes.set(row.filename, row.outputMimeType);
    }
  }
}

export function getSystemImageContentType(filename: string): string | null {
  return contentTypes.get(filename) ?? null;
}

export function setSystemImageContentType(filename: string, contentType: string): void {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".heic" || extension === ".heif") {
    contentTypes.set(filename, contentType);
  }
}
