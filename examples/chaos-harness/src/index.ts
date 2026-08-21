import assert from "node:assert/strict";
import { component, run, workflow } from "@uair/core";
import { VersionedWorkflowRegistry, fingerprintWorkflow, resolveSuspension } from "@uair/core/runtime";
import {
  AtomicCapacityQueueScheduler,
  RoutedWorker,
  WorkerDirectory,
  routeForExecution,
  type RoutedResumeJob,
  type WorkerRegistration
} from "@uair/core/cluster";
import {
  SqliteReliableWorkerQueue,
  SqliteRuntimeState,
  SqliteWorkerRegistry
} from "@uair/sqlite";
import {
  DatabaseSync
} from "node:sqlite";
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

const SEED = Number(
  process.env.UAIR_CHAOS_SEED ??
  0x0badc0de
);

const EXECUTIONS_PER_VERSION = Number(
  process.env.UAIR_CHAOS_EXECUTIONS_PER_VERSION ??
  8
);
const TOTAL_EXECUTIONS = EXECUTIONS_PER_VERSION * 2;

function seeded(seed: number) {
  let state = seed >>> 0;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

const random = seeded(SEED);
const dir = await mkdtemp(
  join(tmpdir(), "uair-chaos-")
);

try {
  const clusterFile = join(dir, "cluster.sqlite");
  const sideEffectFile = join(dir, "side-effects.sqlite");

  const sideEffects = new DatabaseSync(sideEffectFile);
  sideEffects.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;

    CREATE TABLE invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id TEXT NOT NULL,
      effect_id TEXT NOT NULL,
      version TEXT NOT NULL,
      invoked_at INTEGER NOT NULL
    );
  `);

  const approval = component<
    { businessId: string },
    { approved: boolean }
  >(
    "chaos.approval",
    async (input, ctx) =>
      ctx.suspend({
        type: "event",
        eventType: "approval",
        key: input.businessId
      })
  );

  const transient = component<
    { businessId: string },
    { ok: true; attempt: number }
  >(
    "chaos.transient",
    {
      retry: {
        maxAttempts: 2
      }
    },
    async (input, ctx) => {
      const numeric = Number(
        input.businessId.split("-").at(-1)
      );

      if (
        numeric % 3 === 0 &&
        ctx.attempt === 1
      ) {
        throw new Error(
          "seeded transient failure"
        );
      }

      return {
        ok: true,
        attempt: ctx.attempt
      };
    }
  );

  const externalSideEffect = component<
    { businessId: string; version: string },
    { committed: true; effectId: string }
  >(
    "chaos.externalSideEffect",
    async (input, ctx) => {
      sideEffects.prepare(`
        INSERT INTO invocations (
          business_id,
          effect_id,
          version,
          invoked_at
        ) VALUES (?, ?, ?, ?)
      `).run(
        input.businessId,
        ctx.effectId,
        input.version,
        Date.now()
      );

      return {
        committed: true,
        effectId: ctx.effectId
      };
    }
  );

  function makeWorkflow(
    version: string,
    deploymentId: string
  ) {
    return workflow(
      "chaos.order",
      {
        version,
        deploymentId
      },
      async (
        input: {
          businessId: string;
        }
      ) => {
        const decision = await approval({
          businessId: input.businessId
        });

        if (!decision.approved) {
          return {
            status: "rejected" as const,
            version
          };
        }

        await transient({
          businessId: input.businessId
        });

        const committed =
          await externalSideEffect({
            businessId: input.businessId,
            version
          });

        return {
          status: "completed" as const,
          version,
          committed
        };
      }
    );
  }

  const v1 = makeWorkflow("1", "chaos-v1");
  const v2 = makeWorkflow("2", "chaos-v2");

  const state = new SqliteRuntimeState(clusterFile);

  // Independent scheduler instances share only SQLite.
  const registryA = new SqliteWorkerRegistry(clusterFile);
  const registryB = new SqliteWorkerRegistry(clusterFile);
  const registryC = new SqliteWorkerRegistry(clusterFile);

  const queueA = new SqliteReliableWorkerQueue(
    clusterFile,
    new WorkerDirectory(),
    {
      visibilityTimeoutMs: 25,
      maxAttempts: 8,
      backoffMs: () => 0
    }
  );
  const queueB = new SqliteReliableWorkerQueue(
    clusterFile,
    new WorkerDirectory(),
    {
      visibilityTimeoutMs: 25,
      maxAttempts: 8,
      backoffMs: () => 0
    }
  );
  const queueC = new SqliteReliableWorkerQueue(
    clusterFile,
    new WorkerDirectory(),
    {
      visibilityTimeoutMs: 25,
      maxAttempts: 8,
      backoffMs: () => 0
    }
  );

  const schedulerA = new AtomicCapacityQueueScheduler(
    queueA,
    registryA
  );
  const schedulerB = new AtomicCapacityQueueScheduler(
    queueB,
    registryB
  );
  const schedulerC = new AtomicCapacityQueueScheduler(
    queueC,
    registryC
  );

  const now = Date.now();

  const registrations: WorkerRegistration[] = [
    {
      workerId: "v1-a",
      lifecycle: "active",
      capacity: 1,
      queueDepth: 0,
      activeJobs: 0,
      lastHeartbeatAt: now,
      heartbeatLeaseMs: 60,
      capabilities: [{
        workerId: "v1-a",
        workflow: "chaos.order",
        workflowVersion: "1",
        deploymentId: "chaos-v1",
        workflowFingerprint: fingerprintWorkflow(v1)
      }]
    },
    {
      workerId: "v1-b",
      lifecycle: "active",
      capacity: 2,
      queueDepth: 0,
      activeJobs: 0,
      lastHeartbeatAt: now,
      heartbeatLeaseMs: 60,
      capabilities: [{
        workerId: "v1-b",
        workflow: "chaos.order",
        workflowVersion: "1",
        deploymentId: "chaos-v1",
        workflowFingerprint: fingerprintWorkflow(v1)
      }]
    },
    {
      workerId: "v2-a",
      lifecycle: "active",
      capacity: 1,
      queueDepth: 0,
      activeJobs: 0,
      lastHeartbeatAt: now,
      heartbeatLeaseMs: 60,
      capabilities: [{
        workerId: "v2-a",
        workflow: "chaos.order",
        workflowVersion: "2",
        deploymentId: "chaos-v2",
        workflowFingerprint: fingerprintWorkflow(v2)
      }]
    },
    {
      workerId: "v2-b",
      lifecycle: "active",
      capacity: 2,
      queueDepth: 0,
      activeJobs: 0,
      lastHeartbeatAt: now,
      heartbeatLeaseMs: 60,
      capabilities: [{
        workerId: "v2-b",
        workflow: "chaos.order",
        workflowVersion: "2",
        deploymentId: "chaos-v2",
        workflowFingerprint: fingerprintWorkflow(v2)
      }]
    }
  ];

  for (const worker of registrations) {
    registryA.register(worker, now);
  }

  const executions: Array<{
    id: string;
    businessId: string;
    version: string;
  }> = [];

  for (const [workflowDef, version] of [
    [v1, "1"],
    [v2, "2"]
  ] as const) {
    for (
      let i = 0;
      i < EXECUTIONS_PER_VERSION;
      i += 1
    ) {
      const businessId = `order-${version}-${i}`;
      const execution = await run(
        workflowDef,
        { businessId },
        state
      );

      assert.equal(execution.status, "suspended");

      const suspension = execution.history.find(
        entry => entry.kind === "suspension_created"
      );

      assert.ok(
        suspension && suspension.kind === "suspension_created"
      );

      await resolveSuspension(
        suspension.suspensionId,
        { approved: true },
        state,
        "event"
      );

      const refreshed = await state.loadExecution(execution.id);
      assert.ok(refreshed);

      const routed: RoutedResumeJob = {
        executionId: execution.id,
        reason: "event",
        workerId: "",
        route: routeForExecution(refreshed!)
      };

      await queueA.dispatch(routed);

      executions.push({
        id: execution.id,
        businessId,
        version
      });
    }
  }

  const workerRegistries = new Map(
    registrations.map(worker => [worker.workerId, worker])
  );

  function runtimeFor(workerId: string) {
    const registration = workerRegistries.get(workerId)!;
    const workflowDef =
      registration.capabilities[0].workflowVersion === "1"
        ? v1
        : v2;

    return new RoutedWorker(
      registration,
      state,
      new VersionedWorkflowRegistry([
        workflowDef
      ])
    );
  }

  const workers = new Map(
    registrations.map(worker => [
      worker.workerId,
      runtimeFor(worker.workerId)
    ])
  );

  const queues = [queueA, queueB, queueC];
  const registries = [registryA, registryB, registryC];
  const schedulers = [schedulerA, schedulerB, schedulerC];

  let logicalNow = now + 1;
  let crashAfterHandleCount = 0;
  let reclaimedCount = 0;
  let maxObservedLoadRatio = 0;
  let drainTriggered = false;
  let recoveredV1A = false;

  function currentLoad(workerId: string) {
    const records = queueA.list();

    return {
      queueDepth:
        records.filter(
          record =>
            record.state === "queued" &&
            record.job.workerId === workerId
        ).length,
      activeJobs:
        records.filter(
          record =>
            record.state === "leased" &&
            record.leaseOwner === workerId
        ).length
    };
  }

  function publishLoad(workerId: string) {
    // Worker heartbeat is authoritative shared load. A restarted worker
    // reusing the same worker ID must account for old queued/leased jobs
    // still addressed to that identity; reporting zero would temporarily
    // create false capacity and permit overbooking.
    registryA.heartbeat(
      workerId,
      currentLoad(workerId),
      logicalNow
    );
  }

  function assertCapacityInvariant() {
    for (const worker of registryA.list(logicalNow)) {
      const load =
        (worker.queueDepth ?? 0) +
        (worker.activeJobs ?? 0);
      const capacity =
        worker.capacity ?? Number.MAX_SAFE_INTEGER;

      maxObservedLoadRatio = Math.max(
        maxObservedLoadRatio,
        capacity > 0 ? load / capacity : 0
      );

      assert.ok(
        load <= capacity,
        `${worker.workerId} exceeded capacity: ${load}/${capacity}`
      );
    }
  }

  for (
    let step = 0;
    step < 2_000;
    step += 1
  ) {
    logicalNow += 5;

    // Periodic worker heartbeats except workers intentionally crashed.
    for (const worker of registrations) {
      const shared = registryA.list().find(
        item => item.workerId === worker.workerId
      );

      if (!shared || shared.lifecycle === "offline") {
        continue;
      }

      publishLoad(worker.workerId);
    }

    if (!drainTriggered && step >= 8) {
      // Rolling deploy: v1-a stops accepting new executions but is still
      // eligible to finish/resume old v1 work.
      registryB.setLifecycle(
        "v1-a",
        "draining",
        logicalNow
      );
      drainTriggered = true;
    }

    if (
      drainTriggered &&
      !recoveredV1A &&
      step >= 45
    ) {
      // Simulate old pool operator deciding to bring one v1 instance back
      // because old executions remain. This also exercises heartbeat
      // recovery after an offline/crashed period.
      registryC.heartbeat(
        "v1-a",
        {
          lifecycle: "draining",
          ...currentLoad(
            "v1-a"
          )
        },
        logicalNow
      );
      recoveredV1A = true;
    }

    const schedulerResults = await Promise.all(
      schedulers.map(scheduler => scheduler.tick(logicalNow))
    );

    reclaimedCount += schedulerResults.reduce(
      (sum, item) => sum + item.reclaimed,
      0
    );

    assertCapacityInvariant();

    // Shuffle worker order deterministically.
    const workerIds = registrations
      .map(worker => worker.workerId)
      .sort(() => random() - 0.5);

    for (const workerId of workerIds) {
      const shared = registryA.list().find(
        item => item.workerId === workerId
      );

      if (!shared || shared.lifecycle === "offline") {
        continue;
      }

      const queue = queues[
        Math.floor(random() * queues.length)
      ];
      const leased = queue.claim(
        workerId,
        logicalNow
      );

      if (!leased) {
        continue;
      }

      publishLoad(workerId);
      assertCapacityInvariant();

      const result = await workers.get(workerId)!.handle(
        leased.job
      );

      const shouldCrashAfterHandle =
        crashAfterHandleCount < Math.max(
          2,
          Math.floor(TOTAL_EXECUTIONS / 3)
        ) &&
        (
          crashAfterHandleCount === 0 ||
          random() < 0.28
        );

      if (shouldCrashAfterHandle) {
        // The execution (and potentially its external side effect) has
        // durably completed, but the queue lease is deliberately left
        // unacked. This is the most important at-least-once delivery test.
        crashAfterHandleCount += 1;
        registryC.setLifecycle(
          workerId,
          "offline",
          logicalNow
        );
        continue;
      }

      queue.ack(
        leased.jobId,
        leased.leaseToken!,
        logicalNow
      );

      publishLoad(workerId);
      assert.ok(result);
    }

    // Crashed workers remain offline long enough for visibility/heartbeat
    // expiry, then one compatible worker in the same version pool is kept
    // alive. v1-a is restored above as draining; v2-a can recover active.
    if (step > 0 && step % 30 === 0) {
      // Chaos kills worker *instances*, not a deployment forever. Restart
      // offline instances after they have stayed down long enough for both
      // heartbeat and visibility leases to expire. v1-a remains draining
      // after restart to preserve rolling-deploy semantics.
      for (const workerId of registrations.map(item => item.workerId)) {
        const current = registryA.list().find(
          item => item.workerId === workerId
        );

        if (current?.lifecycle === "offline") {
          registryA.heartbeat(
            workerId,
            {
              lifecycle:
                workerId === "v1-a" && drainTriggered
                  ? "draining"
                  : "active",
              ...currentLoad(
                workerId
              )
            },
            logicalNow
          );
        }
      }
    }

    const remaining = queueA.list().filter(
      record => record.state !== "dead"
    );

    const completed = (
      await state.listExecutions()
    ).filter(
      execution => execution.status === "completed"
    );

    if (
      remaining.length === 0 &&
      completed.length === TOTAL_EXECUTIONS
    ) {
      break;
    }
  }

  async function rebuildMissingResumeJobs() {
    const queueRecords =
      queueA.list();

    const queuedExecutionIds =
      new Set(
        queueRecords
          .filter(
            record =>
              record.state !==
                "dead"
          )
          .map(
            record =>
              record.job
                .executionId
          )
      );

    const durable =
      await state
        .listExecutions();

    for (
      const execution
      of durable
    ) {
      if (
        execution.status !==
          "suspended" ||
        queuedExecutionIds.has(
          execution.id
        )
      ) {
        continue;
      }

      const requested =
        execution.history
          .some(
            entry =>
              entry.kind ===
                "resume_requested"
          );

      if (!requested) {
        continue;
      }

      /**
       * Mirror RuntimeEngine recovery semantics: queue state is a
       * disposable delivery projection; durable resume_requested History
       * is the source of truth for rebuilding a missing delivery intent.
       */
      await queueA.dispatch({
        executionId:
          execution.id,
        reason:
          "manual",
        workerId:
          "",
        route:
          routeForExecution(
            execution
          )
      });
    }
  }

  // Deterministic recovery/drain phase. The chaos phase above may end
  // immediately after a worker crash. Stop injecting faults, rebuild any
  // queue delivery intent lost after a durable resume request, restore
  // compatible capacity, and drain.
  for (
    let drainStep = 0;
    drainStep < 500;
    drainStep += 1
  ) {
    logicalNow += 10;

    await rebuildMissingResumeJobs();

    for (
      const workerId
      of registrations.map(
        item => item.workerId
      )
    ) {
      registryA.heartbeat(
        workerId,
        {
          lifecycle:
            workerId === "v1-a" &&
            drainTriggered
              ? "draining"
              : "active",
          ...currentLoad(
            workerId
          )
        },
        logicalNow
      );
    }

    await schedulerA.tick(
      logicalNow
    );

    for (
      const workerId
      of registrations.map(
        item => item.workerId
      )
    ) {
      let leased;

      while (
        (
          leased =
            queueA.claim(
              workerId,
              logicalNow
            )
        )
      ) {
        await workers
          .get(workerId)!
          .handle(
            leased.job
          );

        queueA.ack(
          leased.jobId,
          leased.leaseToken!,
          logicalNow
        );
      }
    }

    const drainRemaining =
      queueA.list().filter(
        record =>
          record.state !== "dead"
      );

    const drainCompleted =
      (
        await state
          .listExecutions()
      ).filter(
        execution =>
          execution.status ===
            "completed"
      );

    if (
      drainRemaining.length === 0 &&
      drainCompleted.length ===
        TOTAL_EXECUTIONS
    ) {
      break;
    }
  }

  const finalExecutions = await state.listExecutions();
  const incomplete = finalExecutions.filter(
    execution => execution.status !== "completed"
  );

  if (
    incomplete.length >
      0
  ) {
    console.error(
      JSON.stringify(
        {
          executions:
            incomplete.map(
              execution => ({
                id:
                  execution.id,
                status:
                  execution.status,
                revision:
                  execution.revision,
                tail:
                  execution.history
                    .slice(-8)
              })
            ),
          queue:
            queueA.list(),
          workers:
            registryA.list(logicalNow)
        },
        null,
        2
      )
    );
  }

  assert.deepEqual(
    incomplete.map(item => ({
      id: item.id,
      status: item.status
    })),
    [],
    "every durable execution must eventually complete"
  );

  assert.equal(
    queueA.list().length,
    0,
    "all reliable jobs must eventually ACK and leave the queue"
  );

  assert.equal(
    queueA.deadLetters().length,
    0,
    "healthy compatible pools must avoid DLQ in this scenario"
  );

  const invocationRows = sideEffects.prepare(`
    SELECT business_id, COUNT(*) AS count
    FROM invocations
    GROUP BY business_id
    ORDER BY business_id
  `).all() as Array<{
    business_id: string;
    count: number;
  }>;

  assert.equal(
    invocationRows.length,
    TOTAL_EXECUTIONS,
    "every approved execution must commit its external side effect"
  );

  for (const row of invocationRows) {
    assert.equal(
      Number(row.count),
      1,
      `external side effect duplicated for ${row.business_id}`
    );
  }

  // Every third order should have produced one durable transient failure,
  // proving component retry happened without duplicating the later side effect.
  const retryFailures = finalExecutions.flatMap(
    execution => execution.history
  ).filter(
    entry =>
      entry.kind === "effect_attempt_failed" &&
      entry.component === "chaos.transient"
  );

  const expectedRetryFailures = executions.filter(item => {
    const numeric = Number(item.businessId.split("-").at(-1));
    return numeric % 3 === 0;
  }).length;

  assert.equal(
    retryFailures.length,
    expectedRetryFailures
  );

  assert.ok(
    crashAfterHandleCount >= 1,
    "chaos seed must exercise crash-after-handle-before-ACK"
  );

  assert.ok(
    reclaimedCount >= 1,
    "at least one expired lease must be reclaimed/redelivered"
  );

  assert.ok(
    maxObservedLoadRatio <= 1,
    "shared capacity must never be oversold"
  );

  console.log(JSON.stringify({
    seed: SEED,
    executions: TOTAL_EXECUTIONS,
    completed: finalExecutions.length,
    sideEffects: invocationRows.length,
    retryFailures: retryFailures.length,
    crashAfterHandleCount,
    reclaimedCount,
    maxObservedLoadRatio,
    deadLetters: queueA.deadLetters().length
  }, null, 2));

  console.log(
    "UAIR v0.36 chaos harness verification: PASS"
  );

  sideEffects.close();
  queueA.close();
  queueB.close();
  queueC.close();
  registryA.close();
  registryB.close();
  registryC.close();
  state.close();
} finally {
  await rm(dir, {
    recursive: true,
    force: true
  });
}
