import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import {
  compressStoredImage,
  imageCompressionFailureCode,
} from "./system-image-compression";
import { setSystemImageContentType } from "./system-image-content-types";
import {
  createSystemImageCompressionJobStore,
  type ClaimedCompressionItem,
} from "./system-image-compression-job-store";

const WORKER_ID = randomUUID();
const POLL_MS = 20_000;
const HEARTBEAT_MS = 30_000;
const store = createSystemImageCompressionJobStore();
let busy = false;
let timer: NodeJS.Timeout | null = null;

async function processOne(): Promise<void> {
  if (busy) return;
  busy = true;
  let claimed: ClaimedCompressionItem | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  try {
    claimed = await store.claim(WORKER_ID);
    if (!claimed) return;
    heartbeat = setInterval(() => {
      void store.renewLease(claimed!, WORKER_ID).catch((error) => {
        logger.warn({ err: error }, "System image compression lease renewal failed");
      });
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const result = await compressStoredImage({
        filename: claimed.filename,
        assetKinds: claimed.assetKinds,
      });
      if (result.status === "compressed") {
        setSystemImageContentType(claimed.filename, result.contentType);
      }
      await store.finish(
        claimed,
        WORKER_ID,
        result.status,
        result.outputBytes,
        result.status === "compressed" ? result.contentType : null,
        result.status === "skipped" ? result.reason : null,
      );
    } catch (error) {
      const failureCode = imageCompressionFailureCode(error);
      const safeSkip = failureCode === "source_too_large" || failureCode === "pixel_limit";
      await store.finish(
        claimed,
        WORKER_ID,
        safeSkip ? "skipped" : "failed",
        null,
        null,
        failureCode,
      );
      logger.warn({
        jobId: claimed.jobId,
        itemId: claimed.itemId,
        failureCode,
      }, "System image compression item failed");
    }
  } catch (error) {
    logger.error({ err: error }, "System image compression worker iteration failed");
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    busy = false;
    schedule();
  }
}

function schedule(delay = POLL_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void processOne();
  }, delay);
  timer.unref();
}

export const systemImageCompressionWorker = {
  kick() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void processOne();
  },
  pause: () => store.pause(),
  resume: async () => {
    const job = await store.resume();
    if (job) systemImageCompressionWorker.kick();
    return job;
  },
  getLatest: () => store.getLatest(),
};

// Only one image is encoded at a time, with a delay between files. Existing
// running jobs resume after a process restart; a paused job stays paused.
systemImageCompressionWorker.kick();
