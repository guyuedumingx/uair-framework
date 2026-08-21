import assert from "node:assert/strict";
import { workflow, run } from "@uair/core";
import { JsonFileStorage, fingerprintWorkflow, VersionedWorkflowRegistry } from "@uair/core/runtime";
import { WorkerDirectory, DeploymentRouter, ReliableWorkerQueue, ReliableWorkerConsumer, RoutedWorker } from "@uair/core/cluster";
import {
  SqliteReliableWorkerQueue
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

const wf =
  workflow(
    "reliable.demo",
    {
      version: "1",
      deploymentId:
        "deploy-r1"
    },
    async () => ({
      ok: true
    })
  );

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-reliable-"
    )
  );

try {
  const storage =
    new JsonFileStorage(
      join(dir, "state")
    );

  const execution =
    await run(
      wf,
      undefined,
      storage
    );

  const fp =
    fingerprintWorkflow(wf);

  const baseNow =
    Date.now();

  const directory =
    new WorkerDirectory()
      .register({
        workerId: "worker-a",
        capacity: 10,
        queueDepth: 0,
        activeJobs: 0,
        lastHeartbeatAt: baseNow,
        heartbeatLeaseMs: 50,
        capabilities: [
          {
            workerId: "worker-a",
            workflow:
              "reliable.demo",
            workflowVersion:
              "1",
            deploymentId:
              "deploy-r1",
            workflowFingerprint:
              fp
          }
        ]
      })
      .register({
        workerId: "worker-b",
        capacity: 10,
        queueDepth: 0,
        activeJobs: 0,
        lastHeartbeatAt: baseNow,
        heartbeatLeaseMs: 10_000,
        capabilities: [
          {
            workerId: "worker-b",
            workflow:
              "reliable.demo",
            workflowVersion:
              "1",
            deploymentId:
              "deploy-r1",
            workflowFingerprint:
              fp
          }
        ]
      });

  const queue =
    new ReliableWorkerQueue(
      directory,
      {
        visibilityTimeoutMs: 50,
        maxAttempts: 3,
        backoffMs: () => 0
      }
    );

  const router =
    new DeploymentRouter(
      storage,
      directory,
      queue
    );

  // At the initial heartbeat time tie-break routes to worker-a.
  const routed =
    await router.route({
      executionId:
        execution.id,
      reason: "manual"
    });

  assert.equal(
    routed.workerId,
    "worker-a"
  );

  const firstLease =
    queue.claim(
      "worker-a",
      baseNow + 10
    );

  assert.ok(firstLease);
  assert.equal(
    firstLease?.attempt,
    1
  );

  // Worker A dies after claim and never ACKs. After 100 ms its heartbeat
  // and job visibility lease are expired. Reclaim must
  // route to worker B instead of losing the job or sticking to A.
  queue.reclaimExpired(
    baseNow + 100
  );

  const requeued =
    queue.list()[0];

  assert.equal(
    requeued.state,
    "queued"
  );

  assert.equal(
    requeued.job.workerId,
    "worker-b"
  );

  const workerB =
    new RoutedWorker(
      directory.list().find(
        item =>
          item.workerId ===
          "worker-b"
      )!,
      storage,
      new VersionedWorkflowRegistry([
        wf
      ])
    );

  const consumer =
    new ReliableWorkerConsumer(
      "worker-b",
      queue,
      workerB
    );

  const result =
    await consumer.runOne(
      baseNow + 100
    );

  assert.equal(
    result?.status,
    "acked"
  );

  assert.equal(
    queue.list().length,
    0,
    "ACK must permanently remove completed job"
  );

  // NACK/redelivery/dead-letter path.
  const execution2 =
    await run(
      wf,
      undefined,
      storage
    );

  directory.setLifecycle(
    "worker-a",
    "offline"
  );

  await router.route({
    executionId:
      execution2.id,
    reason: "manual"
  });

  // A is expired at this timestamp; routePending/retry should use B.
  queue.reclaimExpired(
    baseNow + 200
  );
  queue.routePending(
    baseNow + 200
  );

  const failingConsumer =
    new ReliableWorkerConsumer(
      "worker-b",
      queue,
      {
        async handle() {
          throw new Error(
            "simulated worker failure"
          );
        }
      }
    );

  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    const outcome =
      await failingConsumer
        .runOne(
          baseNow +
            200 + attempt
        );

    assert.equal(
      outcome?.status,
      "nacked"
    );
  }

  assert.equal(
    queue.deadLetters()
      .length,
    1,
    "max-attempt exhaustion must move job to DLQ"
  );

  assert.equal(
    queue.deadLetters()[0]
      .attempt,
    3
  );

  // Durable queue restart scenario: dispatch + claim happen in one
  // scheduler process, then a fresh SqliteReliableWorkerQueue instance
  // reopens the same DB after the original worker disappeared.
  const durableExecution =
    await run(
      wf,
      undefined,
      storage
    );

  directory.setLifecycle(
    "worker-a",
    "active"
  );

  directory.heartbeat(
    "worker-a",
    {
      queueDepth: 0,
      activeJobs: 0
    }
  );

  directory.heartbeat(
    "worker-b",
    {
      queueDepth: 0,
      activeJobs: 0
    }
  );

  const queueFile =
    join(
      dir,
      "jobs.sqlite"
    );

  const durableQueue1 =
    new SqliteReliableWorkerQueue(
      queueFile,
      directory,
      {
        visibilityTimeoutMs: 25,
        maxAttempts: 3,
        backoffMs: () => 0
      }
    );

  const durableRouter =
    new DeploymentRouter(
      storage,
      directory,
      durableQueue1
    );

  const durableRouted =
    await durableRouter.route({
      executionId:
        durableExecution.id,
      reason: "manual"
    });

  const durableLease =
    durableQueue1.claim(
      durableRouted.workerId
    );

  assert.ok(
    durableLease
  );

  const crashedWorker =
    durableLease!.job
      .workerId;

  durableQueue1.close();

  // Simulate scheduler restart and worker death. The durable lease row
  // survives because it was committed to SQLite.
  directory.setLifecycle(
    crashedWorker,
    "offline"
  );

  const survivor =
    crashedWorker ===
      "worker-a"
      ? "worker-b"
      : "worker-a";

  directory.setLifecycle(
    survivor,
    "active"
  );

  directory.heartbeat(
    survivor,
    {
      queueDepth: 0,
      activeJobs: 0
    }
  );

  const durableQueue2 =
    new SqliteReliableWorkerQueue(
      queueFile,
      directory,
      {
        visibilityTimeoutMs: 25,
        maxAttempts: 3,
        backoffMs: () => 0
      }
    );

  durableQueue2
    .reconcileDirectoryLoad();

  durableQueue2
    .reclaimExpired(
      Date.now() + 100
    );

  const persisted =
    durableQueue2.list()[0];

  assert.equal(
    persisted.state,
    "queued"
  );

  assert.equal(
    persisted.job.workerId,
    survivor,
    "expired durable lease must reroute to surviving compatible worker after scheduler restart"
  );

  const survivorLease =
    durableQueue2.claim(
      survivor,
      Date.now() + 100
    );

  assert.ok(
    survivorLease
  );

  durableQueue2.ack(
    survivorLease!.jobId,
    survivorLease!.leaseToken!,
    Date.now() + 100
  );

  assert.equal(
    durableQueue2.list()
      .length,
    0
  );

  durableQueue2.close();

  console.log(
    "UAIR v0.28 reliable queue verification: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
