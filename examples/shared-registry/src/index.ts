import assert from "node:assert/strict";
import {
  WorkerDirectory,
  selectSharedWorker,
  syncWorkerDirectory,
  SharedRegistryQueueScheduler,
  ReliableWorkerQueue,
  type RoutedResumeJob
} from "@uair/core/cluster";
import {
  SqliteWorkerRegistry
} from "@uair/sqlite";
import {
  PostgresWorkerRegistry,
  POSTGRES_WORKER_REGISTRY_SCHEMA,
  type PgQueryable
} from "@uair/postgres";
import {
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

const dir = await mkdtemp(
  join(tmpdir(), "uair-shared-registry-")
);

try {
  const file = join(dir, "registry.sqlite");

  // Two independent scheduler processes would open independent registry
  // instances over the same shared database.
  const registryA = new SqliteWorkerRegistry(file);
  const registryB = new SqliteWorkerRegistry(file);

  const now = Date.now();

  registryA.register({
    workerId: "worker-busy",
    lifecycle: "active",
    capacity: 10,
    queueDepth: 7,
    activeJobs: 2,
    lastHeartbeatAt: now,
    heartbeatLeaseMs: 1_000,
    capabilities: [{
      workerId: "worker-busy",
      workflow: "approval",
      workflowVersion: "2",
      deploymentId: "deploy-v2",
      workflowFingerprint: "fp-v2"
    }]
  }, now);

  registryA.register({
    workerId: "worker-free",
    lifecycle: "active",
    capacity: 10,
    queueDepth: 1,
    activeJobs: 0,
    lastHeartbeatAt: now,
    heartbeatLeaseMs: 1_000,
    capabilities: [{
      workerId: "worker-free",
      workflow: "approval",
      workflowVersion: "2",
      deploymentId: "deploy-v2",
      workflowFingerprint: "fp-v2"
    }]
  }, now);

  const route = {
    workflow: "approval",
    workflowVersion: "2",
    deploymentId: "deploy-v2",
    workflowFingerprint: "fp-v2"
  };

  // Scheduler B immediately sees Scheduler/worker state written through A.
  const selectedByB = await selectSharedWorker(
    registryB,
    route,
    { now }
  );

  assert.equal(
    selectedByB.worker.workerId,
    "worker-free",
    "all schedulers must see the same shared load and choose the less-loaded worker"
  );

  // Lifecycle written by one instance is visible to another.
  registryA.setLifecycle(
    "worker-free",
    "draining",
    now + 10
  );

  const resumeChoice = await selectSharedWorker(
    registryB,
    route,
    {
      intent: "resume",
      now: now + 10
    }
  );

  assert.equal(
    resumeChoice.worker.workerId,
    "worker-free",
    "draining worker remains eligible for old execution resume"
  );

  const newChoice = await selectSharedWorker(
    registryB,
    route,
    {
      intent: "new",
      now: now + 10
    }
  );

  assert.equal(
    newChoice.worker.workerId,
    "worker-busy",
    "draining worker must not receive new executions"
  );

  // A heartbeat published through B changes the shared scheduling view
  // seen by A without any scheduler-to-scheduler messaging.
  registryB.heartbeat(
    "worker-busy",
    {
      queueDepth: 0,
      activeJobs: 0
    },
    now + 20
  );

  const afterHeartbeat = await selectSharedWorker(
    registryA,
    route,
    {
      intent: "resume",
      now: now + 20
    }
  );

  assert.equal(
    afterHeartbeat.worker.workerId,
    "worker-busy"
  );

  // Heartbeat lease expiry is evaluated identically by each scheduler.
  let expiredRejected = false;

  try {
    await selectSharedWorker(
      registryA,
      route,
      {
        intent: "resume",
        now: now + 5_000
      }
    );
  } catch {
    expiredRejected = true;
  }

  assert.equal(expiredRejected, true);

  // Shared registry can refresh the disposable directory used by the
  // existing reliable queue implementation before every scheduler tick.
  registryA.heartbeat(
    "worker-busy",
    {
      lifecycle: "active",
      queueDepth: 0,
      activeJobs: 0
    },
    now + 6_000
  );

  const directory = new WorkerDirectory();
  await syncWorkerDirectory(
    registryB,
    directory,
    now + 6_000
  );

  const queue = new ReliableWorkerQueue(directory);
  const scheduler = new SharedRegistryQueueScheduler(
    queue,
    registryB,
    directory
  );

  const routedJob: RoutedResumeJob = {
    executionId: "exp-shared",
    reason: "manual",
    route,
    workerId: ""
  };

  await queue.dispatch(routedJob);
  await scheduler.tick(now + 6_000);

  const jobs = await queue.list();
  assert.equal(
    jobs[0]?.job.workerId,
    "worker-busy"
  );

  // PostgreSQL contract test: use a fake driver and ensure the shared
  // registry implementation uses UPSERT and the expected shared table.
  const queries: string[] = [];
  const fakePg: PgQueryable = {
    async query(text) {
      queries.push(text);
      return { rows: [] };
    }
  };

  const pgRegistry = new PostgresWorkerRegistry(fakePg);
  await pgRegistry.migrate();

  assert.equal(
    POSTGRES_WORKER_REGISTRY_SCHEMA.includes("uair_worker_registry"),
    true
  );

  await pgRegistry.register({
    workerId: "pg-worker",
    capabilities: [],
    capacity: 4,
    queueDepth: 0,
    activeJobs: 0
  }, now);

  assert.equal(
    queries.some(sql =>
      sql.includes("ON CONFLICT(worker_id)") &&
      sql.includes("last_heartbeat_at") &&
      sql.includes("queue_depth") &&
      sql.includes("active_jobs")
    ),
    true,
    "PostgreSQL registry must atomically upsert shared worker heartbeat/load state"
  );

  registryA.close();
  registryB.close();

  console.log(
    "UAIR v0.30 shared worker registry verification: PASS"
  );
} finally {
  await rm(dir, {
    recursive: true,
    force: true
  });
}
