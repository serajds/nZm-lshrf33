import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { instrumentPool } from "./metrics";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Cloud connections must validate both the CA and hostname. Do not allow a
// URL's sslmode=require/no-verify to weaken node-postgres verification.
const connection = new URL(process.env.DATABASE_URL);
const host = connection.hostname;
// Replit's local PostgreSQL service can use an internal single-label hostname,
// not just localhost. It does not speak TLS; public cloud hosts must do so.
const local = ["localhost", "127.0.0.1", "[::1]"].includes(host)
  || !host.includes(".") && !host.includes(":")
  || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
if (!local) {
  connection.searchParams.set("sslmode", "verify-full");
}
export const pool = new Pool({
  connectionString: connection.toString(),
  ...(!local ? { ssl: { rejectUnauthorized: true } } : {}),
  min: 0,
  max: 10,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: true,
});
instrumentPool(pool);
// pg emits errors for idle clients outside a request. Without a listener these
// can terminate the process. Log codes only; never log connection details.
let lastIdleErrorAt = 0;
let suppressedIdleErrors = 0;
pool.on("error", (error: Error & { code?: string }) => {
  if (Date.now() - lastIdleErrorAt < 30000) { suppressedIdleErrors++; return; }
  console.error("Database idle connection error", { code: error.code ?? "UNKNOWN", suppressedIdleErrors });
  lastIdleErrorAt = Date.now();
  suppressedIdleErrors = 0;
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./metrics";
