import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

import {
  ReleaseController
} from "../packages/builder/dist/index.js";

const proposal = {
  packageName:
    "@acme/commerce",
  version:
    "1.2.0",
  artifacts: [],
  preview: {
    packageName:
      "@acme/commerce",
    entryWorkflow:
      "commerce.checkout",
    surfaces: [],
    capabilities: [],
    demoScenarios: []
  },
  verification: {
    passed:
      true,
    checks: []
  },
  impact: {
    activeExecutionRisk:
      "none",
    versionRecommendation:
      "2",
    notes: []
  },
  changeSafety: {
    safe:
      true,
    issues: []
  },
  migrationPlan: {
    required:
      false,
    releaseAllowed:
      true,
    selected:
      "none",
    options: [],
    actions: [],
    artifacts: [],
    verification: {
      passed:
        true,
      checks: []
    }
  },
  deploymentPlan: {
    releaseAllowed:
      true,
    target: {
      packageName:
        "@acme/commerce",
      packageVersion:
        "1.2.0",
      workflowId:
        "commerce.checkout",
      workflowVersion:
        "2",
      deploymentId:
        "deploy-commerce-checkout-v2"
    },
    previous: {
      workflowVersion:
        "1",
      deploymentIds: [
        "deploy-commerce-checkout-v1"
      ]
    },
    steps: [],
    artifact: {
      path:
        "deployment/release-plan.json",
      content:
        "{}\n"
    },
    verification: {
      passed:
        true,
      checks: []
    }
  },
  permissions: []
};

const storage = {
  async listExecutions() {
    return [];
  }
};

class RecordingAdapter {
  constructor(
    options = {}
  ) {
    this.options =
      options;

    this.calls = [];
  }

  async publishPackage(
    input
  ) {
    this.calls.push([
      "publish",
      input
    ]);

    if (
      this.options.failAt ===
        "publish"
    ) {
      throw new Error(
        "publish failed"
      );
    }
  }

  async deploy(
    plan
  ) {
    this.calls.push([
      "deploy",
      plan.target
        .deploymentId
    ]);

    if (
      this.options.failAt ===
        "deploy"
    ) {
      throw new Error(
        "deploy failed"
      );
    }

    return {
      deploymentId:
        plan.target
          .deploymentId
    };
  }

  async checkHealth(
    input
  ) {
    this.calls.push([
      "health",
      input.deploymentId
    ]);

    if (
      this.options.failAt ===
        "health"
    ) {
      return {
        healthy:
          false,
        detail:
          "candidate unhealthy"
      };
    }

    return {
      healthy:
        true,
      detail:
        "healthy"
    };
  }

  async routeNewExecutions(
    input
  ) {
    this.calls.push([
      "cutover",
      input.deploymentId
    ]);

    if (
      this.options.failAt ===
        "cutover"
    ) {
      throw new Error(
        "cutover failed"
      );
    }
  }

  async rollback(
    input
  ) {
    this.calls.push([
      "rollback",
      input.deploymentId,
      input.reason
    ]);

    if (
      this.options.failRollback
    ) {
      throw new Error(
        "rollback failed"
      );
    }
  }

  async retire() {}
}

async function controller(
  dir,
  adapter
) {
  const result =
    new ReleaseController({
      stateDir:
        dir,
      storage,
      adapter
    });

  await result.saveProposal(
    structuredClone(
      proposal
    ),
    join(
      dir,
      "proposal.json"
    )
  );

  return result;
}

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-deploy-exec-"
    )
  );

try {
  const successAdapter =
    new RecordingAdapter();

  const success =
    await controller(
      join(
        dir,
        "success"
      ),
      successAdapter
    );

  const released =
    await success.release(
      true
    );

  assert.equal(
    released
      .targetDeploymentId,
    "deploy-commerce-checkout-v2"
  );

  assert.deepEqual(
    successAdapter.calls
      .map(
        call =>
          call[0]
      ),
    [
      "publish",
      "deploy",
      "health",
      "cutover"
    ],
    "cutover must happen only after deploy + health pass"
  );

  const successState =
    await success.loadState();

  assert.equal(
    successState
      .releaseAttempts
      .at(-1)
      .status,
    "released"
  );

  assert.deepEqual(
    successState
      .releaseAttempts
      .at(-1)
      .events
      .filter(
        event =>
          event.status ===
            "passed"
      )
      .map(
        event =>
          event.phase
      ),
    [
      "publish",
      "deploy",
      "health",
      "cutover"
    ]
  );

  const callsAfterFirstRelease =
    successAdapter.calls.length;

  await success.release(
    true
  );

  assert.equal(
    successAdapter.calls.length,
    callsAfterFirstRelease,
    "repeated approval after a completed release must be idempotent"
  );

  const resumeAdapter =
    new RecordingAdapter();

  const recovery =
    await controller(
      join(
        dir,
        "recovery"
      ),
      resumeAdapter
    );

  const recoveryState =
    await recovery.loadState();

  recoveryState.releaseAttempts = [
    {
      attemptedAt:
        Date.now(),
      status:
        "in-progress",
      deploymentId:
        "deploy-commerce-checkout-v2",
      events: [
        {
          phase:
            "publish",
          status:
            "passed",
          at:
            Date.now(),
          detail:
            "checkpointed publish"
        },
        {
          phase:
            "deploy",
          status:
            "passed",
          at:
            Date.now(),
          detail:
            "checkpointed deploy"
        }
      ]
    }
  ];

  await writeFile(
    recovery.stateFile,
    JSON.stringify(
      recoveryState,
      null,
      2
    ) + "\n",
    "utf8"
  );

  await recovery.release(
    true
  );

  assert.deepEqual(
    resumeAdapter.calls
      .map(
        call =>
          call[0]
      ),
    [
      "health",
      "cutover"
    ],
    "restart must resume the in-progress release from the last durable checkpoint"
  );

  const recoveredState =
    await recovery.loadState();

  assert.equal(
    recoveredState
      .releaseAttempts
      .at(-1)
      .status,
    "released"
  );

  const failAdapter =
    new RecordingAdapter({
      failAt:
        "health"
    });

  const failure =
    await controller(
      join(
        dir,
        "failure"
      ),
      failAdapter
    );

  await assert.rejects(
    () =>
      failure.release(
        true
      ),
    /candidate unhealthy/
  );

  assert.deepEqual(
    failAdapter.calls
      .map(
        call =>
          call[0]
      ),
    [
      "publish",
      "deploy",
      "health",
      "rollback"
    ],
    "failed health must rollback before any cutover"
  );

  const failedState =
    await failure.loadState();

  assert.equal(
    failedState.released,
    undefined,
    "failed candidate must never become the released target"
  );

  assert.equal(
    failedState
      .releaseAttempts
      .at(-1)
      .status,
    "failed"
  );

  assert.equal(
    failedState
      .releaseAttempts
      .at(-1)
      .events
      .some(
        event =>
          event.phase ===
            "cutover"
      ),
    false
  );

  assert.equal(
    failedState
      .releaseAttempts
      .at(-1)
      .events
      .some(
        event =>
          event.phase ===
            "rollback" &&
          event.status ===
            "passed"
      ),
    true
  );

  const rollbackFailAdapter =
    new RecordingAdapter({
      failAt:
        "cutover",
      failRollback:
        true
    });

  const rollbackFailure =
    await controller(
      join(
        dir,
        "rollback-failure"
      ),
      rollbackFailAdapter
    );

  await assert.rejects(
    () =>
      rollbackFailure
        .release(
          true
        ),
    /cutover failed/
  );

  const rollbackFailState =
    await rollbackFailure
      .loadState();

  assert.equal(
    rollbackFailState
      .releaseAttempts
      .at(-1)
      .events
      .some(
        event =>
          event.phase ===
            "rollback" &&
          event.status ===
            "failed"
      ),
    true,
    "rollback failure must be durable release evidence"
  );

  console.log(
    JSON.stringify(
      {
        phasedRelease:
          "PASS",
        healthBeforeCutover:
          "PASS",
        failedHealthNoCutover:
          "PASS",
        rollback:
          "PASS",
        rollbackFailureEvidence:
          "PASS",
        repeatedApprovalIdempotent:
          "PASS",
        crashCheckpointResume:
          "PASS",
        coreChanges:
          0
      },
      null,
      2
    )
  );

  console.log(
    "UAIR deployment execution/rollback verification: PASS"
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
