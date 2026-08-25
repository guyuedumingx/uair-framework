import pg from "pg";
import { WorkerDirectory } from "../packages/core/dist/cluster-api.js";
import { PostgresReliableWorkerQueue } from "../packages/postgres/dist/index.js";

const { Pool } = pg;
const mode = process.argv[2] ?? "claim-ack";
const workerId = "worker-1";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const directory = new WorkerDirectory();
directory.register({
  workerId,
  capabilities: [],
  lifecycle: "active",
  capacity: 32,
  queueDepth: 1,
  activeJobs: 0,
  lastHeartbeatAt: Date.now(),
  heartbeatLeaseMs: 60_000
});
const queue = new PostgresReliableWorkerQueue(pool, directory, {
  visibilityTimeoutMs: 250
});

try {
  const claimed = await queue.claim(workerId);
  process.stdout.write(`${JSON.stringify({
    pid: process.pid,
    claimed: Boolean(claimed),
    jobId: claimed?.jobId,
    leaseToken: claimed?.leaseToken
  })}\n`);

  if (!claimed) process.exitCode = 2;
  else if (mode === "claim-hold") await new Promise(() => {});
  else await queue.ack(claimed.jobId, claimed.leaseToken);
} finally {
  if (mode !== "claim-hold") await pool.end();
}
