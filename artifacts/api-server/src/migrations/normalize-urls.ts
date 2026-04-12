import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function normalizeAbsoluteUrls(): Promise<{ filesFixed: number; reportsFixed: number }> {
  const fileResult: { rowCount: number } = await db.execute(sql`
    UPDATE project_files
    SET file_url = regexp_replace(file_url, '^https?://[^/]+', '')
    WHERE file_url LIKE 'https://%' OR file_url LIKE 'http://%'
  `);

  const reportResult: { rowCount: number } = await db.execute(sql`
    UPDATE reports
    SET image_urls = (
      SELECT array_agg(regexp_replace(elem, '^https?://[^/]+', ''))
      FROM unnest(image_urls) AS elem
    )
    WHERE image_urls IS NOT NULL
      AND (image_urls::text LIKE '%https://%' OR image_urls::text LIKE '%http://%')
  `);

  const filesFixed = fileResult.rowCount ?? 0;
  const reportsFixed = reportResult.rowCount ?? 0;

  if (filesFixed > 0 || reportsFixed > 0) {
    console.log(`[url-normalize] Fixed ${filesFixed} file URLs and ${reportsFixed} report image arrays`);
  }

  return { filesFixed, reportsFixed };
}
