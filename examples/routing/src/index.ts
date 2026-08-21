import assert from "node:assert/strict";
import { workflow, run } from "@uair/core";
import { JsonFileStorage, fingerprintWorkflow, VersionedWorkflowRegistry } from "@uair/core/runtime";
import { WorkerDirectory, DeploymentRouter, InMemoryWorkerDispatcher, NoCompatibleWorkerError, RoutedWorker } from "@uair/core/cluster";
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

const v1 =
  workflow(
    "approval",
    {
      version: "1",
      deploymentId:
        "deploy-v1"
    },
    async () => "v1"
  );

const v2 =
  workflow(
    "approval",
    {
      version: "2",
      deploymentId:
        "deploy-v2"
    },
    async () => "v2"
  );

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-routing-"
    )
  );

try {
  const storage =
    new JsonFileStorage(
      join(dir, "state")
    );

  const e1 =
    await run(
      v1,
      undefined,
      storage
    );

  const e2 =
    await run(
      v2,
      undefined,
      storage
    );

  const directory =
    new WorkerDirectory()
      .register({
        workerId:
          "worker-v1",
        capabilities: [
          {
            workerId:
              "worker-v1",
            workflow:
              "approval",
            workflowVersion:
              "1",
            deploymentId:
              "deploy-v1",
            workflowFingerprint:
              fingerprintWorkflow(v1)
          }
        ]
      })
      .register({
        workerId:
          "worker-v2",
        capabilities: [
          {
            workerId:
              "worker-v2",
            workflow:
              "approval",
            workflowVersion:
              "2",
            deploymentId:
              "deploy-v2",
            workflowFingerprint:
              fingerprintWorkflow(v2)
          }
        ]
      });

  const dispatcher =
    new InMemoryWorkerDispatcher();

  const router =
    new DeploymentRouter(
      storage,
      directory,
      dispatcher
    );

  const r1 =
    await router.route({
      executionId:
        e1.id,
      reason: "manual"
    });

  const r2 =
    await router.route({
      executionId:
        e2.id,
      reason: "manual"
    });

  assert.equal(
    r1.workerId,
    "worker-v1"
  );

  assert.equal(
    r2.workerId,
    "worker-v2"
  );

  const workerV1 =
    new RoutedWorker(
      directory.list().find(
        item =>
          item.workerId ===
          "worker-v1"
      )!,
      storage,
      new VersionedWorkflowRegistry([
        v1
      ])
    );

  const workerResult =
    await workerV1.handle(
      r1
    );

  assert.equal(
    workerResult.workflowVersion,
    "1"
  );


  assert.equal(
    dispatcher
      .drain("worker-v1")
      [0].executionId,
    e1.id
  );

  assert.equal(
    dispatcher
      .drain("worker-v2")
      [0].executionId,
    e2.id
  );

  const badDirectory =
    new WorkerDirectory()
      .register({
        workerId:
          "wrong-code",
        capabilities: [
          {
            workerId:
              "wrong-code",
            workflow:
              "approval",
            workflowVersion:
              "1",
            deploymentId:
              "deploy-v1",
            workflowFingerprint:
              "different"
          }
        ]
      });

  let rejected =
    false;

  try {
    await new DeploymentRouter(
      storage,
      badDirectory,
      new InMemoryWorkerDispatcher()
    ).route({
      executionId:
        e1.id,
      reason: "manual"
    });
  } catch (error) {
    rejected =
      error instanceof
      NoCompatibleWorkerError;
  }

  // Load-aware routing among workers with the same exact code identity.
  const loadDirectory =
    new WorkerDirectory()
      .register({
        workerId:
          "v2-busy",
        capacity: 10,
        queueDepth: 8,
        activeJobs: 1,
        capabilities: [
          {
            workerId:
              "v2-busy",
            workflow:
              "approval",
            workflowVersion:
              "2",
            deploymentId:
              "deploy-v2",
            workflowFingerprint:
              fingerprintWorkflow(v2)
          }
        ]
      })
      .register({
        workerId:
          "v2-free",
        capacity: 10,
        queueDepth: 1,
        activeJobs: 0,
        capabilities: [
          {
            workerId:
              "v2-free",
            workflow:
              "approval",
            workflowVersion:
              "2",
            deploymentId:
              "deploy-v2",
            workflowFingerprint:
              fingerprintWorkflow(v2)
          }
        ]
      });

  assert.equal(
    loadDirectory.select({
      workflow: "approval",
      workflowVersion: "2",
      deploymentId:
        "deploy-v2",
      workflowFingerprint:
        fingerprintWorkflow(v2)
    }).worker.workerId,
    "v2-free",
    "lower load ratio should win"
  );

  // Draining workers continue old/resume work but reject new admissions.
  loadDirectory.setLifecycle(
    "v2-free",
    "draining"
  );

  assert.equal(
    loadDirectory.select(
      {
        workflow: "approval",
        workflowVersion: "2",
        deploymentId:
          "deploy-v2",
        workflowFingerprint:
          fingerprintWorkflow(v2)
      },
      {
        intent: "resume"
      }
    ).worker.workerId,
    "v2-free"
  );

  assert.equal(
    loadDirectory.select(
      {
        workflow: "approval",
        workflowVersion: "2",
        deploymentId:
          "deploy-v2",
        workflowFingerprint:
          fingerprintWorkflow(v2)
      },
      {
        intent: "new"
      }
    ).worker.workerId,
    "v2-busy",
    "draining worker must not receive new executions"
  );

  // Heartbeat lease expiry removes a dead worker from scheduling.
  const now = Date.now();
  const leaseDirectory =
    new WorkerDirectory()
      .register({
        workerId: "expired",
        lastHeartbeatAt:
          now - 10_000,
        heartbeatLeaseMs: 100,
        capabilities: [
          {
            workerId: "expired",
            workflow: "approval",
            workflowVersion: "1",
            deploymentId:
              "deploy-v1",
            workflowFingerprint:
              fingerprintWorkflow(v1)
          }
        ]
      })
      .register({
        workerId: "alive",
        lastHeartbeatAt: now,
        heartbeatLeaseMs: 100,
        capabilities: [
          {
            workerId: "alive",
            workflow: "approval",
            workflowVersion: "1",
            deploymentId:
              "deploy-v1",
            workflowFingerprint:
              fingerprintWorkflow(v1)
          }
        ]
      });

  assert.equal(
    leaseDirectory.select(
      {
        workflow: "approval",
        workflowVersion: "1",
        deploymentId:
          "deploy-v1",
        workflowFingerprint:
          fingerprintWorkflow(v1)
      },
      {
        now
      }
    ).worker.workerId,
    "alive"
  );

  // Capacity is a hard admission boundary.
  leaseDirectory.heartbeat(
    "alive",
    {
      capacity: 2,
      queueDepth: 1,
      activeJobs: 1
    },
    now
  );

  let capacityRejected = false;

  try {
    leaseDirectory.select(
      {
        workflow: "approval",
        workflowVersion: "1",
        deploymentId:
          "deploy-v1",
        workflowFingerprint:
          fingerprintWorkflow(v1)
      },
      {
        now
      }
    );
  } catch (error) {
    capacityRejected =
      error instanceof
      NoCompatibleWorkerError;
  }

  assert.equal(
    capacityRejected,
    true
  );

  // Graceful drain becomes safe only after both queued and active work hit zero.
  loadDirectory.heartbeat(
    "v2-free",
    {
      lifecycle: "draining",
      queueDepth: 1,
      activeJobs: 1
    }
  );

  assert.equal(
    loadDirectory.canShutdown(
      "v2-free"
    ),
    false
  );

  loadDirectory.heartbeat(
    "v2-free",
    {
      queueDepth: 0,
      activeJobs: 0
    }
  );

  assert.equal(
    loadDirectory.canShutdown(
      "v2-free"
    ),
    true
  );

  console.log(
    "UAIR v0.27 worker lifecycle verification: PASS"
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
