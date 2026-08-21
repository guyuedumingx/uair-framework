import assert from "node:assert/strict";
import {
  WorkerDirectory,
  type JobQueue
} from "@uair/core/cluster";
import {
  SqliteReliableWorkerQueue
} from "@uair/sqlite";
import {
  PostgresReliableWorkerQueue
} from "@uair/postgres";
import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";
import {
  spawn
} from "node:child_process";
import {
  fileURLToPath
} from "node:url";

function acceptsJobQueue(
  queue: JobQueue
) {
  return queue;
}

const dir = await mkdtemp(
  join(tmpdir(), "uair-jobqueue-")
);

try {
  const queueFile = join(dir, "queue.sqlite");
  const directory = new WorkerDirectory()
    .register({
      workerId: "worker-shared",
      capacity: 10,
      queueDepth: 0,
      activeJobs: 0,
      lastHeartbeatAt: Date.now(),
      heartbeatLeaseMs: 60_000,
      capabilities: []
    });

  const q = acceptsJobQueue(
    new SqliteReliableWorkerQueue(
      queueFile,
      directory,
      {visibilityTimeoutMs: 10_000}
    )
  );

  await q.dispatch({
    executionId: "exp-race",
    reason: "manual",
    workerId: "worker-shared",
    route: {
      workflow: "race",
      workflowVersion: "1"
    }
  });

  // Two separate scheduler/worker processes contend for one SQLite row.
  const outA = join(dir, "a.json");
  const outB = join(dir, "b.json");
  const workerScript = fileURLToPath(
    new URL("./claim-worker.js", import.meta.url)
  );
  const startAt = Date.now() + 350;

  const spawnClaim = (out: string) =>
    new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [workerScript, queueFile, out, String(startAt)],
        {stdio: "inherit"}
      );
      child.on("error", reject);
      child.on("exit", code => resolve(code ?? 1));
    });

  const [codeA, codeB] = await Promise.all([
    spawnClaim(outA),
    spawnClaim(outB)
  ]);

  assert.equal(codeA, 0);
  assert.equal(codeB, 0);

  const [a, b] = await Promise.all([
    readFile(outA, "utf8").then(JSON.parse),
    readFile(outB, "utf8").then(JSON.parse)
  ]);

  const winners = [a, b].filter(Boolean);
  assert.equal(
    winners.length,
    1,
    "two scheduler processes must not claim the same durable job"
  );
  assert.equal(winners[0].jobId, "" + winners[0].jobId);


  // Verify two independent leaderless scheduler processes do not both
  // reclaim the same expired SQLite lease.
  const maintenanceFile = join(dir, "maintenance.sqlite");
  const maintenanceDirectory = new WorkerDirectory()
    .register({
      workerId: "worker-shared",
      capacity: 10,
      queueDepth: 0,
      activeJobs: 0,
      lastHeartbeatAt: Date.now(),
      heartbeatLeaseMs: 60_000,
      capabilities: []
    });

  const maintenanceQueue = new SqliteReliableWorkerQueue(
    maintenanceFile,
    maintenanceDirectory,
    {
      visibilityTimeoutMs: 30,
      maxAttempts: 3,
      backoffMs: () => 0
    }
  );

  await maintenanceQueue.dispatch({
    executionId: "exp-maintenance",
    reason: "manual",
    workerId: "worker-shared",
    route: {
      workflow: "race",
      workflowVersion: "1"
    }
  });

  const leaseStart = Date.now();
  const leased = maintenanceQueue.claim("worker-shared", leaseStart);
  assert.ok(leased);
  maintenanceQueue.close();

  const maintainAt = leaseStart + 100;
  const maintenanceScript = fileURLToPath(
    new URL("./maintenance-worker.js", import.meta.url)
  );
  const maintA = join(dir, "maint-a.json");
  const maintB = join(dir, "maint-b.json");

  const spawnMaintenance = (out: string) =>
    new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [maintenanceScript, maintenanceFile, out, String(maintainAt)],
        {stdio: "inherit"}
      );
      child.on("error", reject);
      child.on("exit", code => resolve(code ?? 1));
    });

  const [maintCodeA, maintCodeB] = await Promise.all([
    spawnMaintenance(maintA),
    spawnMaintenance(maintB)
  ]);
  assert.equal(maintCodeA, 0);
  assert.equal(maintCodeB, 0);

  const [maintenanceA, maintenanceB] = await Promise.all([
    readFile(maintA, "utf8").then(JSON.parse),
    readFile(maintB, "utf8").then(JSON.parse)
  ]);

  assert.equal(
    maintenanceA.reclaimed + maintenanceB.reclaimed,
    1,
    "multiple leaderless schedulers must reclaim one expired lease once"
  );

  // PostgreSQL reference implementation compiles against the same SPI.
  // Capture the actual claim SQL: real PostgreSQL concurrency semantics
  // come from row locks + SKIP LOCKED in this one atomic statement.
  const queries: string[] = [];
  const fakePg = {
    async query(text: string) {
      queries.push(text);
      return {rows: []};
    }
  };

  const pgQueue = acceptsJobQueue(
    new PostgresReliableWorkerQueue(
      fakePg,
      directory
    )
  );

  await pgQueue.claim("worker-shared", Date.now());

  const claimSql = queries.at(-1) ?? "";
  assert.match(claimSql, /FOR UPDATE SKIP LOCKED/i);
  assert.match(claimSql, /UPDATE uair_routed_jobs/i);
  assert.match(claimSql, /RETURNING jobs\.\*/i);

  console.log("SQLite concurrent claim winners:", winners.length);
  console.log("Postgres claim uses SKIP LOCKED: true");
  console.log("UAIR v0.29 JobQueue SPI verification: PASS");
} finally {
  await rm(dir, {recursive: true, force: true});
}
