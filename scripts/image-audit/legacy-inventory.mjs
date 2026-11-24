import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { output } from "./common.mjs";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Legacy image inventory is development-only.");
}

const requireDb = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { db, pool } = await import("../../lib/db/src/index.ts");
const { sql } = requireDb("drizzle-orm");

try {
  const report = await db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const fileResult = await tx.execute(sql`
      SELECT mime_type AS "mimeType", count(*)::int AS "files",
        coalesce(sum(file_size), 0)::bigint AS "recordedBytes",
        count(*) FILTER (WHERE filename ~* '\\.(heic|heif|avif|tiff?)$')::int AS "otherRasterFormats"
      FROM project_files
      WHERE category = 'image'
      GROUP BY mime_type
      ORDER BY mime_type
    `);
    const reportResult = await tx.execute(sql`
      WITH urls AS (
        SELECT unnest(image_urls) AS url FROM reports
        UNION
        SELECT jsonb_array_elements_text(group_row->'urls') AS url
        FROM reports
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(image_groups) = 'array' THEN image_groups ELSE '[]'::jsonb END
        ) AS group_row
        WHERE jsonb_typeof(group_row->'urls') = 'array'
      )
      SELECT CASE
          WHEN url LIKE '/api/uploads/%' THEN 'managed-upload'
          WHEN url LIKE 'data:%' THEN 'inline-data'
          WHEN url LIKE 'http%' THEN 'external'
          ELSE 'other'
        END AS "locationKind",
        count(*)::int AS "references",
        count(*) FILTER (WHERE url LIKE '/api/uploads/%' AND NOT EXISTS (
          SELECT 1 FROM project_files pf WHERE pf.file_url = url
        ))::int AS "missingProjectFileReferences"
      FROM urls
      GROUP BY "locationKind"
      ORDER BY "locationKind"
    `);
    const relatedResult = await tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM attendance_records WHERE selfie_filename IS NOT NULL) AS "attendanceImages",
        (SELECT count(*)::int FROM companies WHERE logo_url IS NOT NULL) AS "companyLogos",
        (SELECT count(*)::int FROM (
          SELECT file_url FROM project_files WHERE category = 'image'
          GROUP BY file_url HAVING count(*) > 1
        ) duplicates) AS "duplicateFileUrls"
    `);
    const managedResult = await tx.execute(sql`
      SELECT profile, state, count(*)::int AS "assets",
        coalesce(sum(byte_size), 0)::bigint AS "storedBytes"
      FROM image_assets
      GROUP BY profile, state
      ORDER BY profile, state
    `);
    return {
      recordedAt: new Date().toISOString(),
      environment: "development",
      mode: "read-only metadata inventory; no object listing or content reads",
      projectFiles: fileResult.rows,
      reportReferences: reportResult.rows,
      relatedCounts: relatedResult.rows[0] ?? {},
      alreadyManagedAssets: managedResult.rows,
      dryRun: { status: "PASS_METADATA_ONLY", objectsInspected: 0, assetsChanged: 0, assetsDeleted: 0 },
      blockedChecks: [
        "object metadata and orphan objects",
        "byte-identical duplicate content",
        "legacy sample migration and restart recovery",
      ],
    };
  });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "legacy-inventory.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
