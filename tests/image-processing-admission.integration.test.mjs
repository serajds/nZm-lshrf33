import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { createImageProcessingAdmission, createImageUploadAdmission } from "../artifacts/api-server/src/lib/image-processing-admission.ts";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");

test("image capacity and per-principal fairness are shared between server instances", async () => {
  process.env.NODE_ENV = "development";
  const pg = await isolatedPostgres();
  const pools = [], leases = [];
  try {
    const connectionString = process.env.DATABASE_URL;
    assert.ok(connectionString?.includes("excel-http-pg-"));
    pools.push(new Pool({ connectionString }), new Pool({ connectionString }));
    const services = pools.map(pool => createImageProcessingAdmission(pool));
    const first = await services[0].acquire("user-one");
    leases.push(first);
    await assert.rejects(services[1].acquire("user-one"), error => error.code === "principal_image_busy");
    const second = await services[1].acquire("user-two");
    leases.push(second);
    await assert.rejects(services[0].acquire("user-three"), error => error.code === "image_capacity_busy");
    await first.release();
    await first.release(); // retries must never unlock another owner's slot.
    const third = await services[1].acquire("user-three");
    leases.push(third);
    await assert.rejects(services[0].acquire("user-four"), error => error.code === "image_capacity_busy");
    await third.release();
    await second.release();
    const recovered = await services[0].acquire("user-one");
    leases.push(recovered);
    assert.equal(recovered.signal.aborted, false);
    await recovered.release();
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(services[0].acquire("user-cancelled", cancelled.signal), error => error.code === "cancelled");
    const afterCancel = await services[1].acquire("user-cancelled");
    leases.push(afterCancel);
    await afterCancel.release();
    const uploads = pools.map(pool => createImageUploadAdmission(pool));
    const uploadOne = await uploads[0].acquire("overlap-one");
    const uploadTwo = await uploads[1].acquire("overlap-one");
    leases.push(uploadOne, uploadTwo);
    await assert.rejects(uploads[0].acquire("overlap-one"), error => error.code === "principal_image_busy");
    const uploadOther = await uploads[0].acquire("overlap-two");
    leases.push(uploadOther);
    await assert.rejects(uploads[1].acquire("overlap-three"), error => error.code === "image_capacity_busy");
    const nativeOne = await services[0].acquire("overlap-one");
    leases.push(nativeOne);
    await assert.rejects(services[1].acquire("overlap-one"), error => error.code === "principal_image_busy");
    const nativeOther = await services[1].acquire("overlap-two");
    leases.push(nativeOther);
    await assert.rejects(services[0].acquire("overlap-three"), error => error.code === "image_capacity_busy");
    const { rows: owners } = await pools[0].query(
      "SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=84631 AND objid=0 AND objsubid=2 AND granted",
    );
    assert.equal(owners.length, 1);
    const lost = new Promise((resolve, reject) => {
      nativeOne.signal.addEventListener("abort", resolve, { once: true });
      const timer = setTimeout(() => reject(new Error("connection_loss_did_not_abort_native_work")), 2000);
      timer.unref();
    });
    await pools[1].query("SELECT pg_terminate_backend($1)", [owners[0].pid]);
    await lost;
    await nativeOne.release();
    const afterLoss = await services[1].acquire("overlap-one");
    leases.push(afterLoss);
    await nativeOne.release(); // Old cleanup must not unlock the new owner.
    await assert.rejects(services[0].acquire("overlap-three"), error => error.code === "image_capacity_busy");
  } finally {
    await Promise.all(leases.map(lease => lease.release()));
    await Promise.all(pools.map(pool => pool.end()));
    await pg.stop();
  }
});
