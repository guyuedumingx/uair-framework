import assert from "node:assert/strict";
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

import {
  InMemoryResumeQueue
} from "../packages/core/dist/internal-api.js";

import {
  InvalidJobLeaseError,
  WorkerDirectory
} from "../packages/core/dist/cluster-api.js";

import {
  SqliteReliableWorkerQueue
} from "../packages/sqlite/dist/index.js";

const simple =
  new InMemoryResumeQueue();

await Promise.all(
  Array.from(
    {
      length:
        20
    },
    () =>
      simple.enqueue({
        executionId:
          "same-execution",
        reason:
          "event"
      })
  )
);

assert.equal(
  (
    await simple.drain()
  ).length,
  1,
  "duplicate resume intents must coalesce in the simple queue"
);

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-queue-fault-"
    )
  );

try {
  const directory =
    new WorkerDirectory();

  directory.register({
    workerId:
      "worker-1",
    capabilities: [
      {
        workerId:
          "worker-1",
        workflow:
          "queue.workflow",
        workflowVersion:
          "1",
        deploymentId:
          "deploy-1",
        workflowFingerprint:
          "fp-1"
      }
    ],
    lifecycle:
      "active",
    capacity:
      8,
    queueDepth:
      0,
    activeJobs:
      0,
    lastHeartbeatAt:
      Date.now(),
    heartbeatLeaseMs:
      60 * 60 * 1000
  });

  const queue =
    new SqliteReliableWorkerQueue(
      join(
        dir,
        "queue.sqlite"
      ),
      directory,
      {
        visibilityTimeoutMs:
          50,
        maxAttempts:
          3,
        backoffMs:
          attempt =>
            attempt * 100
      }
    );

  const route = {
    workflow:
      "queue.workflow",
    workflowVersion:
      "1",
    deploymentId:
      "deploy-1",
    workflowFingerprint:
      "fp-1"
  };

  const job =
    executionId => ({
      executionId,
      reason:
        "manual",
      route,
      workerId:
        "worker-1"
    });

  await queue.dispatch(
    job(
      "execution-a"
    )
  );

  await queue.dispatch(
    job(
      "execution-b"
    )
  );

  const base =
    Date.now() +
    10;

  const first =
    await queue.claim(
      "worker-1",
      base
    );

  assert.ok(first);

  const delayedExecution =
    first.job
      .executionId;

  const immediateExecution =
    delayedExecution ===
      "execution-a"
      ? "execution-b"
      : "execution-a";

  await queue.nack(
    first.jobId,
    first.leaseToken,
    "temporary",
    base + 10
  );

  // A is delayed by backoff, therefore B overtakes it.
  const reordered =
    await queue.claim(
      "worker-1",
      base + 20
    );

  assert.equal(
    reordered?.job
      .executionId,
    immediateExecution,
    "delayed retry must not block a later available job"
  );

  await queue.ack(
    reordered.jobId,
    reordered.leaseToken,
    base + 30
  );

  assert.equal(
    await queue.claim(
      "worker-1",
      base + 50
    ),
    null,
    "delayed retry must stay unavailable before backoff expires"
  );

  queue.routePending(
    base + 120
  );

  const retried =
    await queue.claim(
      "worker-1",
      base + 120
    );

  assert.equal(
    retried?.job
      .executionId,
    delayedExecution
  );

  // Simulate worker death: lease expires and is reclaimed.
  queue.reclaimExpired(
    base + 200
  );

  await assert.rejects(
    async () =>
      queue.ack(
        retried.jobId,
        retried.leaseToken,
        base + 201
      ),
    InvalidJobLeaseError,
    "stale worker ack must never delete a reclaimed job"
  );

  queue.routePending(
    base + 400
  );

  const reclaimed =
    await queue.claim(
      "worker-1",
      base + 400
    );

  assert.equal(
    reclaimed?.job
      .executionId,
    delayedExecution
  );

  await queue.ack(
    reclaimed.jobId,
    reclaimed.leaseToken,
    base + 401
  );

  assert.equal(
    queue.list().length,
    0
  );

  queue.close();

  console.log(
    JSON.stringify(
      {
        duplicateCoalescing:
          "PASS",
        reorderAfterBackoff:
          "PASS",
        delayedAvailability:
          "PASS",
        staleAckRejected:
          "PASS",
        expiredLeaseReclaimed:
          "PASS"
      },
      null,
      2
    )
  );

  console.log(
    "UAIR queue duplicate/reorder/delay/lease fault matrix: PASS"
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
