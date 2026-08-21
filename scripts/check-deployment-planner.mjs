import assert from "node:assert/strict";

import {
  ConservativeDeploymentPlanner,
  evaluateRetireGate
} from "../packages/builder/dist/index.js";

const planner =
  new ConservativeDeploymentPlanner();

const plan =
  await planner.plan({
    spec: {
      applicationId:
        "acme.hr.leave",
      name:
        "请假管理",
      packageName:
        "@acme/leave",
      actors: [],
      rules: [],
      capabilities: [],
      surfaces: [],
      workflows: [
        {
          id:
            "hr.leave.request",
          description:
            "leave",
          actors: [],
          rules: [],
          effects: []
        }
      ]
    },
    buildPlan: {
      packageName:
        "@acme/leave",
      workflowIds: [
        "hr.leave.request"
      ],
      workflowVersions: {
        "hr.leave.request":
          "3"
      },
      componentIds: [],
      surfaceKinds: [],
      capabilities: [],
      files: [],
      tests: []
    },
    impact: {
      activeExecutionRisk:
        "high",
      versionRecommendation:
        "keep v2",
      notes: [],
      runtime: {
        activeExecutions:
          2,
        suspendedExecutions:
          1,
        workflows: [
          {
            workflowId:
              "hr.leave.request",
            totalExecutions:
              3,
            running:
              1,
            suspended:
              1,
            completed:
              1,
            failed:
              0,
            cancelled:
              0,
            versions: {
              "1": 1,
              "2": 2
            },
            deployments: {
              "deploy-leave-v2":
                2,
              "deploy-leave-v1":
                1
            },
            suspensionComponents: {
              Surface:
                1
            }
          }
        ]
      }
    },
    migrationPlan: {
      required:
        true,
      releaseAllowed:
        true,
      selected:
        "version-isolation",
      options: [],
      actions: [],
      artifacts: [],
      verification: {
        passed:
          true,
        checks: []
      }
    },
    packageVersion:
      "1.3.0"
  });

assert.equal(
  plan.releaseAllowed,
  true
);

assert.equal(
  plan.target.workflowVersion,
  "3"
);

assert.equal(
  plan.previous
    ?.workflowVersion,
  "2"
);

assert.equal(
  plan.steps.some(
    step =>
      step.phase ===
        "cutover" &&
      step.action ===
        "route-new-executions"
  ),
  true
);

assert.equal(
  plan.retireGate
    ?.ready,
  false
);

assert.equal(
  plan.retireGate
    ?.currentActiveExecutions,
  2
);

const blocked =
  evaluateRetireGate(
    plan,
    {
      workflowId:
        "hr.leave.request",
      totalExecutions:
        3,
      running:
        1,
      suspended:
        1,
      completed:
        1,
      failed:
        0,
      cancelled:
        0,
      versions: {
        "1": 1,
        "2": 2
      },
      deployments: {
        "deploy-leave-v2":
          2
      },
      suspensionComponents: {
        Surface:
          1
      }
    }
  );

assert.equal(
  blocked.ready,
  false
);

const drained =
  evaluateRetireGate(
    plan,
    {
      workflowId:
        "hr.leave.request",
      totalExecutions:
        3,
      running:
        0,
      suspended:
        0,
      completed:
        3,
      failed:
        0,
      cancelled:
        0,
      versions: {
        "1": 1,
        "2": 2
      },
      deployments: {
        "deploy-leave-v2":
          2
      },
      suspensionComponents: {}
    }
  );

assert.equal(
  drained.ready,
  true
);

assert.equal(
  plan.artifact.path,
  "deployment/release-plan.json"
);

console.log(
  JSON.stringify(
    {
      target:
        plan.target,
      previous:
        plan.previous,
      retireGate:
        plan.retireGate,
      blocked,
      drained,
      steps:
        plan.steps
    },
    null,
    2
  )
);

console.log(
  "UAIR Deployment Planner + retire gate verification: PASS"
);
