import assert from "node:assert/strict";
import pg from "pg";

import {
  WorkerDirectory,
  AtomicCapacityQueueScheduler
} from "../../packages/core/dist/cluster-api.js";

import {
  PostgresReliableWorkerQueue,
  PostgresRuntimeSchemaTooNewError,
  PostgresRuntimeState,
  PostgresWorkerRegistry
} from "../../packages/postgres/dist/index.js";

const {
  Pool
} = pg;

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/uair_test";

const pool =
  new Pool({
    connectionString:
      databaseUrl,
    max: 24
  });

const route = {
  workflow:
    "approval",
  workflowVersion:
    "1",
  deploymentId:
    "deploy-v1",
  workflowFingerprint:
    "fingerprint-v1"
};

function worker(
  workerId,
  overrides = {}
) {
  return {
    workerId,
    capabilities: [
      {
        workerId,
        workflow:
          route.workflow,
        workflowVersion:
          route.workflowVersion,
        deploymentId:
          route.deploymentId,
        workflowFingerprint:
          route.workflowFingerprint
      }
    ],
    lifecycle:
      "active",
    capacity: 10,
    queueDepth: 0,
    activeJobs: 0,
    lastHeartbeatAt:
      10_000,
    heartbeatLeaseMs:
      100_000,
    ...overrides
  };
}

function routedJob(
  executionId,
  workerId = ""
) {
  return {
    executionId,
    reason:
      "manual",
    route: {
      ...route
    },
    workerId
  };
}

async function clientQueue(
  client,
  options = {}
) {
  const directory =
    new WorkerDirectory();

  directory.register(
    worker(
      "worker-1"
    )
  );

  return new PostgresReliableWorkerQueue(
    client,
    directory,
    options
  );
}

async function reset() {
  await pool.query(`
    DROP TABLE IF EXISTS uair_outbox;
    DROP TABLE IF EXISTS uair_event_receipts;
    DROP TABLE IF EXISTS uair_inbox;
    DROP TABLE IF EXISTS uair_suspensions;
    DROP TABLE IF EXISTS uair_executions;
    DROP TABLE IF EXISTS uair_runtime_meta;
    DROP TABLE IF EXISTS uair_routed_jobs;
    DROP TABLE IF EXISTS uair_worker_registry;
  `);

  const queue =
    new PostgresReliableWorkerQueue(
      pool,
      new WorkerDirectory()
    );

  const registry =
    new PostgresWorkerRegistry(
      pool
    );

  await queue.migrate();
  await registry.migrate();
}

async function withClients(
  count,
  fn
) {
  const clients =
    await Promise.all(
      Array.from(
        {
          length: count
        },
        () =>
          pool.connect()
      )
    );

  try {
    return await fn(
      clients
    );
  } finally {
    for (
      const client
      of clients
    ) {
      client.release();
    }
  }
}

async function testConcurrentClaim() {
  await reset();

  const writer =
    await clientQueue(
      pool,
      {
        visibilityTimeoutMs:
          500
      }
    );

  await writer.dispatch(
    routedJob(
      "execution-claim",
      "worker-1"
    )
  );

  const now =
    Date.now();

  const winners =
    await withClients(
      12,
      async clients => {
        const results =
          await Promise.all(
            clients.map(
              async client => {
                const queue =
                  await clientQueue(
                    client,
                    {
                      visibilityTimeoutMs:
                        500
                    }
                  );

                return queue.claim(
                  "worker-1",
                  now
                );
              }
            )
          );

        return results.filter(
          Boolean
        );
      }
    );

  assert.equal(
    winners.length,
    1,
    "FOR UPDATE SKIP LOCKED claim must produce exactly one winner for one job"
  );

  assert.equal(
    new Set(
      winners.map(
        item =>
          item.jobId
      )
    ).size,
    1
  );
}

async function testConcurrentReclaim() {
  await reset();

  const writer =
    await clientQueue(
      pool,
      {
        visibilityTimeoutMs:
          20
      }
    );

  await writer.dispatch(
    routedJob(
      "execution-reclaim",
      "worker-1"
    )
  );

  const claimAt =
    Date.now();

  const leased =
    await writer.claim(
      "worker-1",
      claimAt
    );

  assert.ok(leased);

  const reclaimed =
    await withClients(
      8,
      async clients =>
        Promise.all(
          clients.map(
            async client => {
              const queue =
                await clientQueue(
                  client,
                  {
                    visibilityTimeoutMs:
                      20
                  }
                );

              return queue
                .reclaimExpired(
                  leased.leaseExpiresAt ??
                  claimAt + 20
                );
            }
          )
        )
    );

  assert.equal(
    reclaimed.reduce(
      (sum, value) =>
        sum + value,
      0
    ),
    1,
    "one expired lease must be transitioned only once across concurrent schedulers"
  );

  const rows =
    await writer.list();

  assert.equal(
    rows.length,
    1
  );

  assert.equal(
    rows[0].state,
    "queued"
  );

  assert.equal(
    rows[0].job.workerId,
    ""
  );
}

async function testSharedRegistryAcrossConnections() {
  await reset();

  await withClients(
    2,
    async (
      [
        clientA,
        clientB
      ]
    ) => {
      const a =
        new PostgresWorkerRegistry(
          clientA
        );

      const b =
        new PostgresWorkerRegistry(
          clientB
        );

      await a.register(
        worker(
          "shared-worker",
          {
            capacity: 8,
            queueDepth: 2,
            activeJobs: 1
          }
        ),
        10_000
      );

      const seen =
        await b.list(
          10_000
        );

      const record =
        seen.find(
          item =>
            item.workerId ===
            "shared-worker"
        );

      assert.ok(record);

      assert.equal(
        record.queueDepth,
        2
      );

      assert.equal(
        record.activeJobs,
        1
      );

      await b.setLifecycle(
        "shared-worker",
        "draining",
        10_001
      );

      const reread =
        await a.list(
          10_001
        );

      assert.equal(
        reread.find(
          item =>
            item.workerId ===
            "shared-worker"
        )?.lifecycle,
        "draining"
      );
    }
  );
}

async function testAtomicCapacityReservation() {
  await reset();

  const registry =
    new PostgresWorkerRegistry(
      pool
    );

  await registry.register(
    worker(
      "capacity-one",
      {
        capacity: 1,
        queueDepth: 0,
        activeJobs: 0
      }
    ),
    10_000
  );

  const outcomes =
    await withClients(
      12,
      async clients =>
        Promise.all(
          clients.map(
            async client => {
              const current =
                new PostgresWorkerRegistry(
                  client
                );

              try {
                return await current
                  .reserveCapacity(
                    route,
                    {
                      intent:
                        "resume",
                      now: 10_001
                    }
                  );
              } catch {
                return null;
              }
            }
          )
        )
    );

  const winners =
    outcomes.filter(
      Boolean
    );

  assert.equal(
    winners.length,
    1,
    "capacity=1 must admit exactly one concurrent reservation"
  );

  const rows =
    await registry.list(
      10_001
    );

  assert.equal(
    rows.find(
      item =>
        item.workerId ===
        "capacity-one"
    )?.queueDepth,
    1
  );
}

async function testTwoSchedulersOneCapacitySlot() {
  await reset();

  const registeredAt =
    Date.now();

  const registry =
    new PostgresWorkerRegistry(
      pool
    );

  await registry.register(
    worker(
      "atomic-worker",
      {
        capacity: 1,
        queueDepth: 0,
        activeJobs: 0,
        lastHeartbeatAt:
          registeredAt
      }
    ),
    registeredAt
  );

  const writer =
    new PostgresReliableWorkerQueue(
      pool,
      new WorkerDirectory()
    );

  await writer.dispatch(
    routedJob(
      "execution-a"
    )
  );

  await writer.dispatch(
    routedJob(
      "execution-b"
    )
  );

  const schedulerAt =
    Date.now();

  await withClients(
    4,
    async (
      [
        queueClientA,
        registryClientA,
        queueClientB,
        registryClientB
      ]
    ) => {
      const queueA =
        new PostgresReliableWorkerQueue(
          queueClientA,
          new WorkerDirectory()
        );

      const queueB =
        new PostgresReliableWorkerQueue(
          queueClientB,
          new WorkerDirectory()
        );

      const registryA =
        new PostgresWorkerRegistry(
          registryClientA
        );

      const registryB =
        new PostgresWorkerRegistry(
          registryClientB
        );

      const schedulerA =
        new AtomicCapacityQueueScheduler(
          queueA,
          registryA
        );

      const schedulerB =
        new AtomicCapacityQueueScheduler(
          queueB,
          registryB
        );

      const [
        resultA,
        resultB
      ] =
        await Promise.all([
          schedulerA.tick(
            schedulerAt
          ),
          schedulerB.tick(
            schedulerAt
          )
        ]);

      assert.equal(
        resultA.routed +
          resultB.routed,
        1,
        "two schedulers must consume only one shared capacity slot"
      );
    }
  );

  const jobs =
    await writer.list();

  const assigned =
    jobs.filter(
      item =>
        item.job.workerId ===
        "atomic-worker"
    );

  const unassigned =
    jobs.filter(
      item =>
        !item.job.workerId
    );

  assert.equal(
    assigned.length,
    1
  );

  assert.equal(
    unassigned.length,
    1
  );

  const workers =
    await registry.list(
      10_001
    );

  assert.equal(
    workers.find(
      item =>
        item.workerId ===
        "atomic-worker"
    )?.queueDepth,
    1
  );
}


async function resetRuntime() {
  await pool.query(`
    DROP TABLE IF EXISTS uair_outbox;
    DROP TABLE IF EXISTS uair_event_receipts;
    DROP TABLE IF EXISTS uair_inbox;
    DROP TABLE IF EXISTS uair_suspensions;
    DROP TABLE IF EXISTS uair_executions;
    DROP TABLE IF EXISTS uair_runtime_meta;
  `);

  const state =
    new PostgresRuntimeState(
      pool
    );

  await state.migrate();

  return state;
}

async function testRuntimeConcurrentRevision() {
  const state =
    await resetRuntime();

  const seed = {
    id:
      "runtime-race",
    workflow:
      "runtime.workflow",
    workflowVersion:
      "1",
    input: {},
    status:
      "running",
    history: [],
    revision:
      0
  };

  await state.saveExecution(
    seed
  );

  assert.equal(
    seed.revision,
    1
  );

  const copies =
    await Promise.all(
      Array.from(
        {
          length:
            12
        },
        () =>
          state.loadExecution(
            seed.id
          )
      )
    );

  const results =
    await Promise.allSettled(
      copies.map(
        async (
          copy,
          index
        ) => {
          copy.status =
            "completed";

          copy.result = {
            winner:
              index
          };

          await state.saveExecution(
            copy,
            1
          );

          return index;
        }
      )
    );

  assert.equal(
    results.filter(
      item =>
        item.status ===
          "fulfilled"
    ).length,
    1,
    "PostgreSQL optimistic revision UPSERT must have one winner"
  );

  assert.equal(
    results.filter(
      item =>
        item.status ===
          "rejected"
    ).length,
    11
  );

  const final =
    await state.loadExecution(
      seed.id
    );

  assert.equal(
    final.revision,
    2
  );
}


async function testRuntimeConcurrentCreate() {
  const state =
    await resetRuntime();

  const attempts =
    Array.from(
      {
        length:
          12
      },
      (
        _,
        index
      ) => ({
        id:
          "runtime-create-race",
        workflow:
          "runtime.workflow",
        workflowVersion:
          "1",
        input: {
          contender:
            index
        },
        status:
          "running",
        history: [],
        revision:
          0
      })
    );

  const results =
    await Promise.allSettled(
      attempts.map(
        execution =>
          state.saveExecution(
            execution,
            0
          )
      )
    );

  assert.equal(
    results.filter(
      item =>
        item.status ===
          "fulfilled"
    ).length,
    1,
    "missing-row optimistic create race must have exactly one winner"
  );

  assert.equal(
    results.filter(
      item =>
        item.status ===
          "rejected"
    ).length,
    11
  );

  const final =
    await state.loadExecution(
      "runtime-create-race"
    );

  assert.equal(
    final.revision,
    1
  );
}

async function testRuntimeTransactionRollbackOnDatabaseError() {
  const state =
    await resetRuntime();

  const execution = {
    id:
      "runtime-trigger-rollback",
    workflow:
      "runtime.workflow",
    workflowVersion:
      "1",
    input: {},
    status:
      "running",
    history: [],
    revision:
      0
  };

  await state.saveExecution(
    execution
  );

  await pool.query(`
    CREATE OR REPLACE FUNCTION
      uair_test_fail_suspension()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.suspension_id =
        'boom-suspension'
      THEN
        RAISE EXCEPTION
          'injected suspension write failure';
      END IF;

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS
      uair_test_fail_suspension_trigger
    ON uair_suspensions;

    CREATE TRIGGER
      uair_test_fail_suspension_trigger
    BEFORE INSERT OR UPDATE
    ON uair_suspensions
    FOR EACH ROW
    EXECUTE FUNCTION
      uair_test_fail_suspension();
  `);

  const suspension = {
    kind:
      "suspension_created",
    path:
      "0",
    component:
      "Wait",
    effectId:
      "effect-trigger",
    generation:
      0,
    suspensionId:
      "boom-suspension",
    createdAt:
      Date.now(),
    spec: {
      type:
        "interaction"
    }
  };

  const candidate =
    structuredClone(
      execution
    );

  candidate.status =
    "suspended";

  candidate.history.push(
    suspension
  );

  try {
    await assert.rejects(
      () =>
        state
          .saveExecutionAndIndexSuspension(
            candidate,
            suspension,
            1
          ),
      /injected suspension write failure/
    );

    const final =
      await state.loadExecution(
        execution.id
      );

    assert.equal(
      final.revision,
      1,
      "execution revision update must roll back when suspension write fails"
    );

    assert.equal(
      final.status,
      "running"
    );

    assert.equal(
      final.history.length,
      0
    );

    assert.equal(
      await state.findSuspension(
        suspension.suspensionId
      ),
      null
    );
  } finally {
    await pool.query(`
      DROP TRIGGER IF EXISTS
        uair_test_fail_suspension_trigger
      ON uair_suspensions;

      DROP FUNCTION IF EXISTS
        uair_test_fail_suspension();
    `);
  }
}

async function testRuntimeSuspensionAtomicity() {
  const state =
    await resetRuntime();

  const execution = {
    id:
      "runtime-suspension",
    workflow:
      "runtime.workflow",
    workflowVersion:
      "1",
    input: {},
    status:
      "running",
    history: [],
    revision:
      0
  };

  await state.saveExecution(
    execution
  );

  const suspension = {
    kind:
      "suspension_created",
    path:
      "0",
    component:
      "Wait",
    effectId:
      "effect-1",
    generation:
      0,
    suspensionId:
      "suspension-1",
    createdAt:
      Date.now(),
    spec: {
      type:
        "interaction"
    }
  };

  execution.status =
    "suspended";

  execution.history.push(
    suspension
  );

  await state
    .saveExecutionAndIndexSuspension(
      execution,
      suspension,
      1
    );

  assert.equal(
    execution.revision,
    2
  );

  assert.ok(
    await state.findSuspension(
      suspension.suspensionId
    )
  );

  const a =
    await state.loadExecution(
      execution.id
    );

  const b =
    structuredClone(
      a
    );

  for (
    const copy
    of [
      a,
      b
    ]
  ) {
    copy.status =
      "completed";

    copy.history.push({
      kind:
        "suspension_resolved",
      suspensionId:
        suspension
          .suspensionId,
      resolvedAt:
        Date.now(),
      value:
        true
    });
  }

  const results =
    await Promise.allSettled([
      state
        .saveExecutionAndRemoveSuspension(
          a,
          suspension
            .suspensionId,
          2
        ),
      state
        .saveExecutionAndRemoveSuspension(
          b,
          suspension
            .suspensionId,
          2
        )
    ]);

  assert.equal(
    results.filter(
      item =>
        item.status ===
          "fulfilled"
    ).length,
    1
  );

  assert.equal(
    await state.findSuspension(
      suspension.suspensionId
    ),
    null,
    "winning transaction must atomically remove the suspension index"
  );

  const final =
    await state.loadExecution(
      execution.id
    );

  assert.equal(
    final.revision,
    3
  );

  assert.equal(
    final.history.filter(
      item =>
        item.kind ===
          "suspension_resolved"
    ).length,
    1
  );
}

async function testRuntimeSchemaForwardRefusal() {
  await resetRuntime();

  await pool.query(`
    UPDATE uair_runtime_meta
    SET value = '999'
    WHERE key =
      'runtime_schema_version'
  `);

  const state =
    new PostgresRuntimeState(
      pool
    );

  await assert.rejects(
    () =>
      state.migrate(),
    PostgresRuntimeSchemaTooNewError
  );
}

async function main() {
  await pool.query(
    "SELECT 1 AS ok"
  );

  await testConcurrentClaim();
  console.log(
    "✓ concurrent claim"
  );

  await testConcurrentReclaim();
  console.log(
    "✓ concurrent reclaim"
  );

  await testSharedRegistryAcrossConnections();
  console.log(
    "✓ shared registry"
  );

  await testAtomicCapacityReservation();
  console.log(
    "✓ atomic capacity reservation"
  );

  await testTwoSchedulersOneCapacitySlot();
  console.log(
    "✓ two schedulers / one capacity slot"
  );

  await testRuntimeConcurrentRevision();
  console.log(
    "✓ runtime concurrent revision"
  );

  await testRuntimeConcurrentCreate();
  console.log(
    "✓ runtime concurrent create"
  );

  await testRuntimeTransactionRollbackOnDatabaseError();
  console.log(
    "✓ runtime transaction rollback on database error"
  );

  await testRuntimeSuspensionAtomicity();
  console.log(
    "✓ runtime suspension atomicity"
  );

  await testRuntimeSchemaForwardRefusal();
  console.log(
    "✓ runtime schema forward refusal"
  );

  console.log(
    "UAIR v0.61 PostgreSQL integration verification: PASS"
  );
}

try {
  await main();
} finally {
  await pool.end();
}
