import {
  VersionedWorkflowRegistry,
  fingerprintWorkflow
} from "@uair/core/runtime";
import {
  RoutedWorker,
  WorkerDirectory,
  type WorkerRegistration
} from "@uair/core/cluster";
import {
  SqliteReliableWorkerQueue,
  SqliteRuntimeState
} from "@uair/sqlite";
import {
  createCrashWorkflow
} from "./workflow.js";

const clusterFile =
  process.env.UAIR_CLUSTER_FILE!;
const sideEffectFile =
  process.env.UAIR_SIDE_EFFECT_FILE!;
const workerId =
  process.env.UAIR_WORKER_ID!;
const mode =
  process.env.UAIR_WORKER_MODE ??
  "normal";

if (
  !clusterFile ||
  !sideEffectFile ||
  !workerId
) {
  throw new Error(
    "Missing worker environment"
  );
}

const workflow =
  createCrashWorkflow(
    sideEffectFile
  );

const registration:
  WorkerRegistration = {
  workerId,
  lifecycle: "active",
  capacity: 1,
  queueDepth: 0,
  activeJobs: 0,
  lastHeartbeatAt:
    Date.now(),
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
        fingerprintWorkflow(
          workflow
        )
    }
  ]
};

const state =
  new SqliteRuntimeState(
    clusterFile
  );

const queue =
  new SqliteReliableWorkerQueue(
    clusterFile,
    new WorkerDirectory(),
    {
      visibilityTimeoutMs:
        250,
      maxAttempts: 5,
      backoffMs: () => 0
    }
  );

const worker =
  new RoutedWorker(
    registration,
    state,
    new VersionedWorkflowRegistry([
      workflow
    ])
  );

try {
  const leased =
    queue.claim(
      workerId,
      Date.now()
    );

  if (!leased) {
    console.log(
      "NO_JOB"
    );

    process.exitCode = 2;
  } else {
    await worker.handle(
      leased.job
    );

    if (
      mode ===
        "pause-before-ack"
    ) {
      console.log(
        JSON.stringify({
          event:
            "HANDLE_COMPLETED_BEFORE_ACK",
          jobId:
            leased.jobId,
          leaseToken:
            leased.leaseToken,
          executionId:
            leased.job.executionId,
          pid:
            process.pid
        })
      );

      // Parent process will SIGKILL this process here.
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            60_000
          )
      );
    }

    queue.ack(
      leased.jobId,
      leased.leaseToken!,
      Date.now()
    );

    console.log(
      JSON.stringify({
        event: "ACKED",
        jobId:
          leased.jobId,
        executionId:
          leased.job.executionId,
        pid:
          process.pid
      })
    );
  }
} finally {
  queue.close();
  state.close();
}
