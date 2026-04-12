import { db } from "@workspace/db";
import { projectFilesTable, reportsTable } from "@workspace/db";
import { sql, like, or } from "drizzle-orm";

export async function normalizeAbsoluteUrls(): Promise<{ filesFixed: number; reportsFixed: number }> {
  const fileResult = await db.execute(sql`
    UPDATE project_files
    SET file_url = regexp_replace(file_url, '^https?://[^/]+', '')
    WHERE file_url LIKE 'https://%' OR file_url LIKE 'http://%'
  `);

  const reportResult = await db.execute(sql`
    UPDATE reports
    SET image_urls = (
      SELECT array_agg(regexp_replace(elem, '^https?://[^/]+', ''))
      FROM unnest(image_urls) AS elem
    )
    WHERE image_urls IS NOT NULL
      AND image_urls::text LIKE '%https://%'
  `);

  const filesFixed = (fileResult as any).rowCount ?? 0;
  const reportsFixed = (reportResult as any).rowCount ?? 0;

  if (filesFixed > 0 || reportsFixed > 0) {
    console.log(`[url-normalize] Fixed ${filesFixed} file URLs and ${reportsFixed} report image arrays`);
  }

  return { filesFixed, reportsFixed };
}
