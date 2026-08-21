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
  WorkerDirectory
} from "../packages/core/dist/cluster-api.js";
import {
  JsonFileStorage,
  StorageConflictError
} from "../packages/core/dist/runtime-api.js";
import {
  SqliteReliableWorkerQueue,
  SqliteWorkerRegistry
} from "../packages/sqlite/dist/index.js";
import {
  classifyError,
  collectRuntimeMetrics,
  drainWorker,
  healthReport,
  recoverDeadLetter,
  storageHealthCheck,
  workerRegistryHealthCheck
} from "../packages/ops/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-ops-"
    )
  );

try {
  const storage =
    new JsonFileStorage(
      join(
        dir,
        "executions"
      )
    );

  const storageReport =
    await healthReport([
      storageHealthCheck(
        storage
      )
    ]);

  assert.equal(
    storageReport.status,
    "up"
  );

  assert.equal(
    storageReport.ready,
    true
  );

  const classified =
    classifyError(
      new StorageConflictError(
        "conflict"
      )
    );

  assert.deepEqual(
    {
      category:
        classified.category,
      disposition:
        classified.disposition,
      code:
        classified.code,
      retryable:
        classified.retryable
    },
    {
      category:
        "conflict",
      disposition:
        "retry",
      code:
        "UAIR_STORAGE_CONFLICT",
      retryable:
        true
    }
  );

  const registry =
    new SqliteWorkerRegistry(
      join(
        dir,
        "workers.sqlite"
      )
    );

  registry.register({
    workerId:
      "worker-a",
    capabilities: [
      {
        workerId:
          "worker-a",
        workflow:
          "orders",
        workflowVersion:
          "1"
      }
    ],
    lifecycle:
      "active",
    capacity:
      10,
    queueDepth:
      0,
    activeJobs:
      0,
    heartbeatLeaseMs:
      30_000
  });

  const registryReport =
    await healthReport([
      workerRegistryHealthCheck(
        registry
      )
    ]);

  assert.equal(
    registryReport.ready,
    true
  );

  const drained =
    await drainWorker(
      registry,
      "worker-a",
      {
        timeoutMs:
          10,
        pollMs:
          1
      }
    );

  assert.equal(
    drained.drained,
    true
  );

  assert.equal(
    registry.list()[0]
      .lifecycle,
    "offline"
  );

  const directory =
    new WorkerDirectory();

  directory.register({
    workerId:
      "worker-a",
    capabilities: [
      {
        workerId:
          "worker-a",
        workflow:
          "orders",
        workflowVersion:
          "1"
      }
    ],
    lifecycle:
      "active"
  });

  const queue =
    new SqliteReliableWorkerQueue(
      join(
        dir,
        "queue.sqlite"
      ),
      directory,
      {
        maxAttempts:
          1,
        visibilityTimeoutMs:
          100
      }
    );

  await queue.dispatch({
    executionId:
      "execution-1",
    workerId:
      "worker-a",
    route: {
      workflow:
        "orders",
      workflowVersion:
        "1"
    },
    suspensionId:
      "suspension-1",
    value: {
      approved:
        true
    }
  });

  const leased =
    queue.claim(
      "worker-a"
    );

  assert.ok(leased);

  queue.nack(
    leased.jobId,
    leased.leaseToken,
    "poison payload"
  );

  assert.equal(
    queue.deadLetters()
      .length,
    1
  );

  const metricsBeforeRecovery =
    await collectRuntimeMetrics({
      storage,
      workers:
        registry,
      deadLetters:
        queue,
      now:
        () => 1234
    });

  assert.equal(
    metricsBeforeRecovery
      .deadLetters,
    1
  );

  assert.equal(
    metricsBeforeRecovery
      .observedAt,
    1234
  );

  const recovered =
    await recoverDeadLetter(
      queue,
      leased.jobId,
      {
        resetAttempts:
          true
      }
    );

  assert.deepEqual(
    recovered,
    {
      recovered:
        true,
      reason:
        "requeued"
    }
  );

  assert.equal(
    queue.deadLetters()
      .length,
    0
  );

  const queued =
    queue.list()
      .find(
        job =>
          job.jobId ===
          leased.jobId
      );

  assert.equal(
    queued.state,
    "queued"
  );

  assert.equal(
    queued.attempt,
    0
  );

  queue.close();
  registry.close();

  console.log(
    JSON.stringify(
      {
        structuredErrors:
          "PASS",
        healthReadiness:
          "PASS",
        gracefulDrain:
          "PASS",
        deadLetterRecovery:
          "PASS",
        stableMetricsSnapshot:
          "PASS",
        corePrimitivesAdded:
          0
      },
      null,
      2
    )
  );

  console.log(
    "UAIR operability reference verification: PASS"
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
