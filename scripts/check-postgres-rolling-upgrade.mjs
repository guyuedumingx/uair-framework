import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";

import {
  NoCompatibleWorkerError,
  WorkerDirectory
} from "../packages/core/dist/cluster-api.js";
import { PostgresRuntimeState } from "../packages/postgres/dist/index.js";

if (!process.env.DATABASE_URL) {
  console.error("POSTGRES ROLLING UPGRADE FAIL: DATABASE_URL is required");
  process.exit(2);
}

const previousVersion = process.env.UAIR_PREVIOUS_VERSION ?? "0.67.0";
const fixture = await mkdtemp(join(tmpdir(), "uair-previous-runtime-"));
const install = spawnSync("npm", [
  "install", "--prefix", fixture, "--ignore-scripts", "--no-audit", "--no-fund",
  `@uair/core@${previousVersion}`,
  `@uair/postgres@${previousVersion}`
], { stdio: "inherit", env: process.env });
if (install.status !== 0) process.exit(install.status ?? 1);

const previousModule = join(
  fixture, "node_modules", "@uair", "postgres", "dist", "index.js"
);
const candidateModule = join(process.cwd(), "packages", "postgres", "dist", "index.js");
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });

function worker(modulePath, label, delay = 0) {
  const child = spawn(process.execPath, [
    "scripts/postgres-mixed-binary-worker.mjs", modulePath, label, String(delay)
  ], {
    cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "inherit"]
  });
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("exit", () => {
      const line = output.trim().split("\n").find(Boolean);
      if (!line) return reject(new Error(`${label} worker produced no result`));
      resolve(JSON.parse(line));
    });
  });
}

try {
  await pool.query(`
    DROP TABLE IF EXISTS uair_outbox;
    DROP TABLE IF EXISTS uair_event_receipts;
    DROP TABLE IF EXISTS uair_inbox;
    DROP TABLE IF EXISTS uair_suspensions;
    DROP TABLE IF EXISTS uair_executions;
    DROP TABLE IF EXISTS uair_runtime_meta;
  `);
  const state = new PostgresRuntimeState(pool);
  await state.migrate();
  await state.saveExecution({
    id: "rolling-execution",
    workflow: "rolling.workflow",
    workflowVersion: "1",
    deploymentId: "deploy-v1",
    workflowFingerprint: "fingerprint-v1",
    historySchemaVersion: 4,
    input: { writes: [] },
    status: "suspended",
    history: []
  });

  assert.equal((await worker(previousModule, "previous"))?.status, "saved");
  assert.equal((await worker(candidateModule, "candidate"))?.status, "saved");
  const mixed = await state.loadExecution("rolling-execution");
  assert.deepEqual(mixed.input.writes, ["previous", "candidate"]);

  const conflict = await Promise.all([
    worker(previousModule, "previous-race", 150),
    worker(candidateModule, "candidate-race", 150)
  ]);
  assert.equal(conflict.filter(item => item.status === "saved").length, 1);
  assert.equal(conflict.filter(item => item.status === "rejected").length, 1);

  const directory = new WorkerDirectory();
  directory.register({
    workerId: "worker-v1",
    lifecycle: "draining",
    capacity: 2,
    queueDepth: 1,
    activeJobs: 0,
    capabilities: [{
      workerId: "worker-v1", workflow: "rolling.workflow", workflowVersion: "1",
      deploymentId: "deploy-v1", workflowFingerprint: "fingerprint-v1"
    }]
  });
  directory.register({
    workerId: "worker-v2",
    lifecycle: "active",
    capacity: 2,
    capabilities: [{
      workerId: "worker-v2", workflow: "rolling.workflow", workflowVersion: "2",
      deploymentId: "deploy-v2", workflowFingerprint: "fingerprint-v2"
    }]
  });
  assert.equal(directory.select({
    workflow: "rolling.workflow", workflowVersion: "1",
    deploymentId: "deploy-v1", workflowFingerprint: "fingerprint-v1"
  }, { intent: "resume" }).worker.workerId, "worker-v1");
  assert.equal(directory.select({
    workflow: "rolling.workflow", workflowVersion: "2",
    deploymentId: "deploy-v2", workflowFingerprint: "fingerprint-v2"
  }, { intent: "new" }).worker.workerId, "worker-v2");
  assert.throws(() => directory.select({
    workflow: "rolling.workflow", workflowVersion: "1",
    deploymentId: "deploy-v1", workflowFingerprint: "fingerprint-v1"
  }, { intent: "new" }), NoCompatibleWorkerError);
  assert.equal(directory.canShutdown("worker-v1"), false);
  directory.heartbeat("worker-v1", { queueDepth: 0, activeJobs: 0, lifecycle: "draining" });
  assert.equal(directory.canShutdown("worker-v1"), true);

  console.log(JSON.stringify({
    previousVersion,
    candidateVersion: "0.68.0",
    sharedPostgresWrites: "PASS",
    crossBinaryRevisionConflict: "FIRST_WRITER_WINS",
    oldPinnedResume: "worker-v1",
    newAdmission: "worker-v2",
    oldWorkerShutdownAfterDrain: true
  }, null, 2));
  console.log("UAIR PostgreSQL mixed-binary rolling upgrade verification: PASS");
} finally {
  await pool.end();
  await rm(fixture, { recursive: true, force: true });
}
