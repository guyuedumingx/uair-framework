import assert from "node:assert/strict";
import {
  AtomicCapacityQueueScheduler,
  WorkerDirectory,
  type RoutedResumeJob
} from "@uair/core/cluster";
import {
  SqliteReliableWorkerQueue,
  SqliteWorkerRegistry
} from "@uair/sqlite";
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
  join(tmpdir(), "uair-capacity-")
);

try {
  const file = join(dir, "cluster.sqlite");

  const registryA = new SqliteWorkerRegistry(file);
  const registryB = new SqliteWorkerRegistry(file);

  const now = Date.now();

  registryA.register({
    workerId: "worker-one",
    lifecycle: "active",
    capacity: 1,
    queueDepth: 0,
    activeJobs: 0,
    lastHeartbeatAt: now,
    heartbeatLeaseMs: 60_000,
    capabilities: [{
      workerId: "worker-one",
      workflow: "approval",
      workflowVersion: "1",
      deploymentId: "deploy-1",
      workflowFingerprint: "fp-1"
    }]
  }, now);

  const queueA = new SqliteReliableWorkerQueue(
    file,
    new WorkerDirectory()
  );
  const queueB = new SqliteReliableWorkerQueue(
    file,
    new WorkerDirectory()
  );

  const route = {
    workflow: "approval",
    workflowVersion: "1",
    deploymentId: "deploy-1",
    workflowFingerprint: "fp-1"
  };

  const job = (id: string): RoutedResumeJob => ({
    executionId: id,
    reason: "manual",
    workerId: "",
    route
  });

  await queueA.dispatch(job("exp-a"));
  await queueA.dispatch(job("exp-b"));

  const schedulerA = new AtomicCapacityQueueScheduler(
    queueA,
    registryA
  );
  const schedulerB = new AtomicCapacityQueueScheduler(
    queueB,
    registryB
  );

  const tickAt = Date.now();

  const [a, b] = await Promise.all([
    schedulerA.tick(tickAt),
    schedulerB.tick(tickAt)
  ]);

  const records = await queueA.list();
  const assigned = records.filter(
    record => !!record.job.workerId
  );
  const pending = records.filter(
    record => !record.job.workerId
  );
  const worker = (await registryA.list())[0];

  assert.equal(
    a.routed + b.routed,
    1,
    "two schedulers must consume only one final capacity slot"
  );
  assert.equal(assigned.length, 1);
  assert.equal(pending.length, 1);
  assert.equal(worker.queueDepth, 1);

  // Simulate worker heartbeat after it consumes/completes the queued job.
  registryB.heartbeat(
    "worker-one",
    { queueDepth: 0 },
    tickAt + 1
  );

  const c = await schedulerA.tick(Date.now());
  assert.equal(c.routed, 1);

  const finalRecords = await queueA.list();
  assert.equal(
    finalRecords.filter(r => !!r.job.workerId).length,
    2
  );

  console.log(
    "UAIR v0.31 atomic capacity reservation verification: PASS"
  );

  queueA.close();
  queueB.close();
  registryA.close();
  registryB.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
