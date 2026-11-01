import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

// Never connect to, clone, or change the configured development/production DB.
// A private Unix socket (no TCP listener) and a fresh cluster isolate every run.
export async function isolatedPostgres() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1", "do not run fixtures in a deployment");
  const root = path.resolve("generated-artifacts");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "excel-http-pg-"));
  // Unix socket paths have a small OS length limit.
  const socket = path.join(dir, "s");
  const data = path.join(dir, "data");
  const previousUrl = process.env.DATABASE_URL;
  let started = false;
  const stop = async () => {
    try {
      if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      await rm(dir, { recursive: true, force: true });
    }
  };
  try {
    await mkdir(socket);
    execFileSync("initdb", ["-D", data, "-U", "fixture", "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(dir, "postgres.log"),
      "-o", `-F -h '' -k ${socket}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    // This URL contains no secret; it only reaches this test's private socket.
    process.env.DATABASE_URL = `postgresql://fixture@localhost/postgres?host=${encodeURIComponent(socket)}`;
    execFileSync("pnpm", ["--filter", "@workspace/db", "exec", "drizzle-kit", "push", "--force"], {
      env: process.env, stdio: "pipe", timeout: 60_000,
    });
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
