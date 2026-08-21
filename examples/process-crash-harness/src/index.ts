import assert from "node:assert/strict";
import {
  run
} from "@uair/core";
import {
  fingerprintWorkflow,
  resolveSuspension
} from "@uair/core/runtime";
import {
  AtomicCapacityQueueScheduler,
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
  join,
  resolve
} from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  tmpdir
} from "node:os";
import {
  spawn,
  type ChildProcess
} from "node:child_process";
import {
  createInterface
} from "node:readline";
import {
  createCrashWorkflow
} from "./workflow.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-process-crash-"
    )
  );

function waitForJsonEvent(
  child: ChildProcess,
  eventName: string,
  timeoutMs = 10_000
) {
  return new Promise<any>(
    (
      resolvePromise,
      reject
    ) => {
      const timer =
        setTimeout(
          () => {
            reject(
              new Error(
                `Timed out waiting for ${eventName}`
              )
            );
          },
          timeoutMs
        );

      const stdout =
        child.stdout;

      if (!stdout) {
        clearTimeout(timer);
        reject(
          new Error(
            "Child stdout is unavailable"
          )
        );
        return;
      }

      const lines =
        createInterface({
          input: stdout
        });

      lines.on(
        "line",
        line => {
          try {
            const value =
              JSON.parse(line);

            if (
              value.event ===
                eventName
            ) {
              clearTimeout(timer);
              lines.close();
              resolvePromise(
                value
              );
            }
          } catch {
            // Ignore non-JSON diagnostic output.
          }
        }
      );

      child.once(
        "exit",
        (
          code,
          signal
        ) => {
          if (
            eventName !==
              "PROCESS_EXIT" &&
            code !== null
          ) {
            // The timeout remains the authoritative failure if the
            // process exited without producing the expected marker.
          }

          if (
            eventName ===
              "PROCESS_EXIT"
          ) {
            clearTimeout(timer);
            resolvePromise({
              code,
              signal
            });
          }
        }
      );
    }
  );
}

function spawnWorker(
  rootDir: string,
  clusterFile: string,
  sideEffectFile: string,
  workerId: string,
  mode: string
) {
  return spawn(
    process.execPath,
    [
      resolve(
        rootDir,
        "examples/process-crash-harness/dist/worker.js"
      )
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        UAIR_CLUSTER_FILE:
          clusterFile,
        UAIR_SIDE_EFFECT_FILE:
          sideEffectFile,
        UAIR_WORKER_ID:
          workerId,
        UAIR_WORKER_MODE:
          mode,
        NODE_NO_WARNINGS:
          "1"
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    }
  );
}

try {
  const rootDir =
    resolve(
      fileURLToPath(
        new URL(
          "../../../",
          import.meta.url
        )
      )
    );

  const clusterFile =
    join(
      dir,
      "cluster.sqlite"
    );

  const sideEffectFile =
    join(
      dir,
      "side-effects.sqlite"
    );

  const sideEffectDb =
    new DatabaseSync(
      sideEffectFile
    );

  sideEffectDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id TEXT NOT NULL,
      effect_id TEXT NOT NULL,
      invoked_at INTEGER NOT NULL
    );
  `);

  sideEffectDb.close();

  const workflow =
    createCrashWorkflow(
      sideEffectFile
    );

  const fingerprint =
    fingerprintWorkflow(
      workflow
    );

  const state =
    new SqliteRuntimeState(
      clusterFile
    );

  const directory =
    new WorkerDirectory();

  const queue =
    new SqliteReliableWorkerQueue(
      clusterFile,
      directory,
      {
        visibilityTimeoutMs:
          250,
        maxAttempts: 5,
        backoffMs: () => 0
      }
    );

  const registry =
    new SqliteWorkerRegistry(
      clusterFile
    );

  const scheduler =
    new AtomicCapacityQueueScheduler(
      queue,
      registry
    );

  const now =
    Date.now();

  function registration(
    workerId: string,
    lifecycle:
      "active" |
      "draining" |
      "offline" =
      "active"
  ):
    WorkerRegistration {
    return {
      workerId,
      lifecycle,
      capacity: 1,
      queueDepth: 0,
      activeJobs: 0,
      lastHeartbeatAt:
        now,
      heartbeatLeaseMs:
        30_000,
      capabilities: [
        {
          workerId,
          workflow:
            workflow.name,
          workflowVersion:
            workflow.version,
          deploymentId:
            workflow.deploymentId,
          workflowFingerprint:
            fingerprint
        }
      ]
    };
  }

  registry.register(
    registration(
      "worker-crash"
    ),
    now
  );

  registry.register(
    registration(
      "worker-survivor"
    ),
    now
  );

  const execution =
    await run(
      workflow,
      {
        businessId:
          "kill9-order-1"
      },
      state
    );

  assert.equal(
    execution.status,
    "suspended"
  );

  const suspension =
    execution.history.find(
      entry =>
        entry.kind ===
          "suspension_created"
    );

  assert.ok(
    suspension &&
    suspension.kind ===
      "suspension_created"
  );

  await resolveSuspension(
    suspension.suspensionId,
    {
      approved: true
    },
    state,
    "event"
  );

  const readyExecution =
    await state.loadExecution(
      execution.id
    );

  assert.ok(
    readyExecution
  );

  const routed:
    RoutedResumeJob = {
    executionId:
      execution.id,
    reason: "event",
    workerId:
      "worker-crash",
    route:
      routeForExecution(
        readyExecution!
      )
  };

  await queue.dispatch(
    routed
  );

  const crashWorker =
    spawnWorker(
      rootDir,
      clusterFile,
      sideEffectFile,
      "worker-crash",
      "pause-before-ack"
    );

  let stderr = "";
  crashWorker.stderr?.on(
    "data",
    chunk => {
      stderr +=
        String(chunk);
    }
  );

  const marker =
    await waitForJsonEvent(
      crashWorker,
      "HANDLE_COMPLETED_BEFORE_ACK"
    );

  assert.equal(
    marker.executionId,
    execution.id
  );

  const beforeKill =
    queue.list();

  assert.equal(
    beforeKill.length,
    1
  );

  assert.equal(
    beforeKill[0].state,
    "leased"
  );

  assert.equal(
    beforeKill[0].leaseOwner,
    "worker-crash"
  );

  // This is a real OS-level hard kill. No finally block, ACK, heartbeat,
  // or graceful shutdown code can run in the worker process.
  const killedExitPromise =
    new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>(resolveExit => {
      crashWorker.once(
        "exit",
        (code, signal) =>
          resolveExit({
            code,
            signal
          })
      );
    });

  const killed =
    crashWorker.kill(
      "SIGKILL"
    );

  assert.equal(
    killed,
    true
  );

  const killedExit =
    await killedExitPromise;

  assert.equal(
    killedExit.signal,
    "SIGKILL"
  );

  assert.equal(
    stderr,
    ""
  );

  registry.setLifecycle(
    "worker-crash",
    "offline",
    Date.now()
  );

  registry.heartbeat(
    "worker-survivor",
    {
      lifecycle:
        "active",
      queueDepth: 0,
      activeJobs: 0
    },
    Date.now()
  );

  const leaseExpiresAt =
    beforeKill[0]
      .leaseExpiresAt!;

  const waitMs =
    Math.max(
      0,
      leaseExpiresAt -
        Date.now() +
        30
    );

  await new Promise(
    resolveWait =>
      setTimeout(
        resolveWait,
        waitMs
      )
  );

  const reclaimNow =
    Date.now();

  registry.heartbeat(
    "worker-survivor",
    {
      lifecycle:
        "active",
      queueDepth: 0,
      activeJobs: 0
    },
    reclaimNow
  );

  const schedulerResult =
    await scheduler.tick(
      reclaimNow
    );

  assert.equal(
    schedulerResult.reclaimed,
    1
  );

  assert.equal(
    schedulerResult.routed,
    1
  );

  const rerouted =
    queue.list();

  assert.equal(
    rerouted.length,
    1
  );

  assert.equal(
    rerouted[0].state,
    "queued"
  );

  assert.equal(
    rerouted[0].job.workerId,
    "worker-survivor"
  );

  const survivor =
    spawnWorker(
      rootDir,
      clusterFile,
      sideEffectFile,
      "worker-survivor",
      "normal"
    );

  let survivorStderr = "";
  survivor.stderr?.on(
    "data",
    chunk => {
      survivorStderr +=
        String(chunk);
    }
  );

  const survivorExit =
    new Promise<void>(
      (resolveExit, rejectExit) => {
        survivor.once(
          "exit",
          (code, signal) => {
            if (
              code === 0
            ) {
              resolveExit();
            } else {
              rejectExit(
                new Error(
                  `survivor exited code=${code} signal=${signal}`
                )
              );
            }
          }
        );
      }
    );

  const acked =
    await waitForJsonEvent(
      survivor,
      "ACKED"
    );

  assert.equal(
    acked.executionId,
    execution.id
  );

  await survivorExit;

  assert.equal(
    survivorStderr,
    ""
  );

  const finalExecution =
    await state.loadExecution(
      execution.id
    );

  assert.equal(
    finalExecution?.status,
    "completed"
  );

  assert.equal(
    queue.list().length,
    0,
    "survivor must ACK the redelivered job"
  );

  const verifyDb =
    new DatabaseSync(
      sideEffectFile
    );

  const countRow =
    verifyDb.prepare(`
      SELECT COUNT(*) AS count
      FROM invocations
      WHERE business_id = ?
    `).get(
      "kill9-order-1"
    ) as any;

  verifyDb.close();

  assert.equal(
    Number(
      countRow.count
    ),
    1,
    "external side effect must execute once before SIGKILL and must not repeat on redelivery"
  );

  assert.equal(
    queue.deadLetters().length,
    0
  );

  console.log(
    JSON.stringify(
      {
        executions: 1,
        sigkill: 1,
        reclaimed: 1,
        redelivered: 1,
        externalSideEffects: 1,
        deadLetters: 0
      },
      null,
      2
    )
  );

  console.log(
    "UAIR v0.36 process SIGKILL verification: PASS"
  );

  queue.close();
  registry.close();
  state.close();
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
