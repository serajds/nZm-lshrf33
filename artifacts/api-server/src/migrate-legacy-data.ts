import path from "node:path";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { migrateExistingUploads } from "./lib/fileStorage";
import { normalizeAbsoluteUrls } from "./migrations/normalize-urls";

async function main() {
  try {
    const normalized = await normalizeAbsoluteUrls();
    logger.info(normalized, "Legacy report and file URLs checked");

    const uploads = await migrateExistingUploads(path.join(process.cwd(), "uploads"));
    if (uploads.skipped) {
      logger.warn("Legacy upload migration skipped; bucket or uploads directory is unavailable");
    } else if (uploads.failed > 0) {
      throw new Error(`Legacy upload migration failed for ${uploads.failed} file(s)`);
    }
    logger.info(uploads, "Legacy upload migration finished");
    logger.info("Legacy data maintenance completed");
  } catch (error) {
    logger.error({ error }, "Legacy data maintenance failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
