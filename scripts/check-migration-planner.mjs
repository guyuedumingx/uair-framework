import assert from "node:assert/strict";

import {
  workflow
} from "../packages/core/dist/index.js";

import {
  VersionedWorkflowRegistry
} from "../packages/core/dist/runtime-api.js";

import {
  ConservativeMigrationPlanner
} from "../packages/builder/dist/index.js";

const planner =
  new ConservativeMigrationPlanner();

const base = {
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
  changeSet: {
    items: [],
    summary: {
      added: 0,
      modified: 1,
      removed: 0,
      affectedNodes: 0
    }
  },
  changeSafety: {
    safe: true,
    issues: []
  }
};

const incompatible =
  await planner.plan({
    ...base,
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
      surfaceKinds: [
        "hr.leave.manager-approval"
      ],
      capabilities: [],
      files: [],
      tests: []
    },
    contractCompatibility: {
      compatible: false,
      issues: [
        {
          severity:
            "error",
          code:
            "PENDING_SURFACE_PAYLOAD_INCOMPATIBLE",
          message:
            "old payload lacks departmentId",
          kind:
            "surface",
          id:
            "hr.leave.manager-approval"
        }
      ],
      runtimePayloadChecks: [
        {
          surfaceKind:
            "hr.leave.manager-approval",
          samples:
            1,
          compatible:
            false,
          issues: [
            "departmentId missing"
          ]
        }
      ]
    },
    impact: {
      activeExecutionRisk:
        "high",
      versionRecommendation:
        "publish new version",
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
            suspensionComponents: {
              Surface: 1
            }
          }
        ]
      }
    }
  });

assert.equal(
  incompatible.selected,
  "version-isolation"
);

assert.equal(
  incompatible.releaseAllowed,
  true
);

assert.equal(
  incompatible.verification.passed,
  true
);

assert.equal(
  incompatible.actions.some(
    item =>
      item.type ===
        "keep-workflow-version" &&
      item.fromVersion ===
        "2" &&
      item.toVersion ===
        "3"
  ),
  true
);

assert.equal(
  incompatible.actions.some(
    item =>
      item.type ===
        "keep-deployment"
  ),
  true
);

assert.equal(
  incompatible.artifacts.some(
    item =>
      item.path ===
        "migration/version-isolation.json"
  ),
  true
);

const noVersionBump =
  await planner.plan({
    ...base,
    buildPlan: {
      packageName:
        "@acme/leave",
      workflowIds: [
        "hr.leave.request"
      ],
      workflowVersions: {
        "hr.leave.request":
          "2"
      },
      componentIds: [],
      surfaceKinds: [],
      capabilities: [],
      files: [],
      tests: []
    },
    contractCompatibility: {
      compatible: false,
      issues: [],
      runtimePayloadChecks: []
    },
    impact: {
      activeExecutionRisk:
        "high",
      versionRecommendation:
        "new version required",
      notes: [],
      runtime: {
        activeExecutions:
          1,
        suspendedExecutions:
          1,
        workflows: [
          {
            workflowId:
              "hr.leave.request",
            totalExecutions:
              1,
            running:
              0,
            suspended:
              1,
            completed:
              0,
            failed:
              0,
            cancelled:
              0,
            versions: {
              "2": 1
            },
            suspensionComponents: {
              Surface: 1
            }
          }
        ]
      }
    }
  });

assert.equal(
  noVersionBump.releaseAllowed,
  false
);

assert.equal(
  noVersionBump.verification.passed,
  false
);

const noMigration =
  await planner.plan({
    ...base,
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
    contractCompatibility: {
      compatible: true,
      issues: [],
      runtimePayloadChecks: []
    },
    impact: {
      activeExecutionRisk:
        "low",
      versionRecommendation:
        "v3",
      notes: [],
      runtime: {
        activeExecutions:
          0,
        suspendedExecutions:
          0,
        workflows: [
          {
            workflowId:
              "hr.leave.request",
            totalExecutions:
              4,
            running:
              0,
            suspended:
              0,
            completed:
              4,
            failed:
              0,
            cancelled:
              0,
            versions: {
              "1": 2,
              "2": 2
            },
            suspensionComponents: {}
          }
        ]
      }
    }
  });

assert.equal(
  noMigration.selected,
  "none"
);

assert.equal(
  noMigration.required,
  false
);

const v2 =
  workflow({
    id:
      "hr.leave.request",
    version:
      "2",
    async run() {
      return {
        version:
          "2"
      };
    }
  });

const v3 =
  workflow({
    id:
      "hr.leave.request",
    version:
      "3",
    async run() {
      return {
        version:
          "3"
      };
    }
  });

const registry =
  new VersionedWorkflowRegistry([
    v2,
    v3
  ]);

const oldExecution = {
  id:
    "old-execution",
  workflow:
    "hr.leave.request",
  workflowVersion:
    "2",
  input: {},
  status:
    "suspended",
  history: []
};

const newExecution = {
  ...oldExecution,
  id:
    "new-execution",
  workflowVersion:
    "3"
};

assert.equal(
  registry.resolveExecution(
    oldExecution
  ),
  v2,
  "version-isolation must keep old execution pinned to v2"
);

assert.equal(
  registry.resolveExecution(
    newExecution
  ),
  v3,
  "new execution must resolve to v3"
);

console.log(
  JSON.stringify(
    {
      incompatiblePlan:
        incompatible,
      noVersionBump:
        noVersionBump,
      noMigration:
        noMigration,
      routing: {
        old:
          "v2",
        new:
          "v3"
      }
    },
    null,
    2
  )
);

console.log(
  "UAIR Migration Planner + version isolation verification: PASS"
);
