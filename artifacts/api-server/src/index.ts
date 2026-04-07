import app from "./app";
import { logger } from "./lib/logger";
import { seed } from "./seed";
import { migrateExistingUploads } from "./lib/fileStorage";
import path from "path";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  await seed();
  
  const uploadsDir = path.join(process.cwd(), "uploads");
  migrateExistingUploads(uploadsDir).catch((err) => {
    logger.error({ err }, "Failed to migrate existing uploads");
  });
});
