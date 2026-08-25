import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

import { WorkerDirectory } from "../packages/core/dist/cluster-api.js";
import { PostgresReliableWorkerQueue } from "../packages/postgres/dist/index.js";

if (!process.env.DATABASE_URL) {
  console.error("POSTGRES MULTIPROCESS FAIL: DATABASE_URL is required");
  process.exit(2);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const directory = new WorkerDirectory();
directory.register({
  workerId: "worker-1",
  capabilities: [],
  lifecycle: "active",
  capacity: 32,
  queueDepth: 0,
  activeJobs: 0,
  lastHeartbeatAt: Date.now(),
  heartbeatLeaseMs: 60_000
});
const queue = new PostgresReliableWorkerQueue(pool, directory, {
  visibilityTimeoutMs: 250
});

const job = executionId => ({
  executionId,
  reason: "manual",
  workerId: "worker-1",
  route: {
    workflow: "multiprocess.contract",
    workflowVersion: "1"
  }
});

function child(mode) {
  return spawn(process.execPath, ["scripts/postgres-process-worker.mjs", mode], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"]
  });
}

function result(process) {
  return new Promise((resolve, reject) => {
    let output = "";
    process.stdout.on("data", chunk => { output += chunk; });
    process.on("error", reject);
    process.on("exit", code => {
      const line = output.trim().split("\n").find(Boolean);
      if (!line) return reject(new Error(`worker produced no result (exit ${code})`));
      resolve(JSON.parse(line));
    });
  });
}

async function resetQueue() {
  await pool.query("DROP TABLE IF EXISTS uair_routed_jobs");
  await queue.migrate();
}

await resetQueue();
await queue.dispatch(job("execution-process-race"));
const race = await Promise.all(
  Array.from({ length: 12 }, () => result(child("claim-ack")))
);
assert.equal(race.filter(item => item.claimed).length, 1,
  "one durable job must have one claim winner across processes");
assert.equal((await queue.list()).length, 0);

await queue.dispatch(job("execution-process-kill"));
const holder = child("claim-hold");
const held = await new Promise((resolve, reject) => {
  let output = "";
  holder.stdout.on("data", chunk => {
    output += chunk;
    const line = output.trim().split("\n").find(Boolean);
    if (line) resolve(JSON.parse(line));
  });
  holder.on("error", reject);
});
assert.equal(held.claimed, true);
holder.kill("SIGKILL");
await new Promise(resolve => holder.once("exit", resolve));
await new Promise(resolve => setTimeout(resolve, 300));
assert.equal(await queue.reclaimExpired(), 1,
  "expired lease from SIGKILLed process must be reclaimed once");
assert.equal(await queue.assign(held.jobId, "worker-1"), true,
  "reclaimed unassigned work must be routable to a fresh worker");
const recovered = await result(child("claim-ack"));
assert.equal(recovered.claimed, true);
assert.equal(recovered.jobId, held.jobId);
assert.equal((await queue.list()).length, 0);

await pool.end();
console.log(JSON.stringify({
  contenderProcesses: 12,
  claimWinners: 1,
  sigkillReclaimed: 1,
  recoveredByFreshProcess: true
}, null, 2));
console.log("UAIR PostgreSQL multiprocess/SIGKILL verification: PASS");
