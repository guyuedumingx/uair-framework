import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
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
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  buildProjectGraph,
  inventoryFromProjectGraph,
  DurableRuntimeImpactAnalyzer,
  createBuilderWorkflow,
  createProjectAwareBuilderDefaults
} from "../packages/builder/dist/index.js";

const project =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-project-graph-"
    )
  );

const runtimeDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-runtime-impact-"
    )
  );

try {
  await mkdir(
    join(
      project,
      "src"
    ),
    {
      recursive: true
    }
  );

  await writeFile(
    join(
      project,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "@acme/leave",
        version:
          "1.2.0",
        type:
          "module",
        dependencies: {
          "@acme/platform":
            "^2.0.0"
        }
      },
      null,
      2
    )
  );

  await writeFile(
    join(
      project,
      "src",
      "leave.ts"
    ),
    `
import {
  workflow,
  component
} from "@uair/core";

import {
  surface
} from "@uair/ui";

export const balance =
  component({
    id:
      "leave.balance.read",
    async run() {
      return {
        remaining: 10
      };
    }
  });

export const leave =
  workflow({
    id:
      "hr.leave.request",
    version:
      "2",

    async run(input: {
      employeeId: string;
      days: number;
      reason: string;
    }) {
      const balance =
        await balance();

      return surface({
        kind:
          "hr.leave.manager-approval",
        data: {
          input,
          balance
        }
      });
    }
  });
`
  );

  const graph =
    await buildProjectGraph(
      project
    );

  const inventory =
    inventoryFromProjectGraph(
      graph
    );

  assert.equal(
    inventory.packages
      .includes(
        "@acme/leave"
      ),
    true
  );

  assert.equal(
    inventory.workflows
      .some(
        item =>
          item.id ===
            "hr.leave.request"
      ),
    true
  );

  assert.equal(
    inventory.workflows
      .find(
        item =>
          item.id ===
            "hr.leave.request"
      )?.version,
    "2"
  );

  assert.equal(
    inventory.capabilities
      .includes(
        "leave.balance.read"
      ),
    true
  );

  assert.equal(
    inventory.surfaces
      .includes(
        "hr.leave.manager-approval"
      ),
    true
  );

  const storage =
    new JsonFileStorage(
      join(
        runtimeDir,
        "executions"
      )
    );

  await storage.saveExecution({
    id:
      "active-1",
    workflow:
      "hr.leave.request",
    workflowVersion:
      "2",
    input: {},
    status:
      "suspended",
    history: [
      {
        kind:
          "suspension_created",
        path:
          "0",
        component:
          "Surface",
        effectId:
          "effect-1",
        generation:
          0,
        suspensionId:
          "suspension-1",
        createdAt:
          Date.now(),
        input: {
          kind:
            "hr.leave.manager-approval",
          data: {
            input: {
              employeeId:
                "E1001",
              days: 5,
              reason:
                "家庭安排"
            },
            balance: {
              remaining: 10
            }
          }
        },
        spec: {
          type:
            "ui"
        }
      }
    ]
  });

  await storage.saveExecution({
    id:
      "active-2",
    workflow:
      "hr.leave.request",
    workflowVersion:
      "2",
    input: {},
    status:
      "running",
    history: []
  });

  await storage.saveExecution({
    id:
      "old-completed",
    workflow:
      "hr.leave.request",
    workflowVersion:
      "1",
    input: {},
    status:
      "completed",
    history: [],
    result: {
      approved: true
    }
  });

  const analyzer =
    new DurableRuntimeImpactAnalyzer(
      storage
    );

  const impact =
    await analyzer.analyze(
      {
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
              "modified leave workflow",
            actors: [],
            rules: [],
            effects: []
          }
        ]
      },
      {
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
      inventory
    );

  assert.equal(
    impact.activeExecutionRisk,
    "high"
  );

  assert.equal(
    impact.runtime
      .activeExecutions,
    2
  );

  assert.equal(
    impact.runtime
      .suspendedExecutions,
    1
  );

  assert.equal(
    impact.runtime
      .workflows[0]
      .versions["2"],
    2
  );

  assert.equal(
    impact.runtime
      .workflows[0]
      .versions["1"],
    1
  );

  assert.match(
    impact.versionRecommendation,
    /new Workflow version/
  );


  const projectAware =
    createBuilderWorkflow(
      createProjectAwareBuilderDefaults(
        project,
        storage
      )
    );

  const buildExecution =
    await run(
      projectAware,
      {
        description:
          "修改现有请假系统：所有请假直属经理审批，超过2天部门负责人追加审批，余额不足不能提交，审批后写入考勤并审计。",
        companyScope:
          "acme",
        packageName:
          "@acme/leave"
      },
      storage
    );

  assert.equal(
    buildExecution.status,
    "completed"
  );

  const build =
    buildExecution.result;

  assert.equal(
    build.plan
      .workflowVersions[
        "hr.leave.request"
      ],
    "3"
  );

  assert.equal(
    build.proposal
      .impact
      .activeExecutionRisk,
    "high"
  );


  assert.equal(
    build.proposal
      .changeSafety
      ?.safe,
    true
  );

  assert.equal(
    build.proposal
      .architectureGovernance
      ?.healthy,
    true
  );

  assert.equal(
    build.proposal
      .contractCompatibility
      ?.compatible,
    true
  );

  assert.equal(
    build.proposal
      .migrationPlan
      ?.selected,
    "version-isolation"
  );

  assert.equal(
    build.proposal
      .migrationPlan
      ?.releaseAllowed,
    true
  );

  assert.equal(
    build.proposal
      .deploymentPlan
      ?.releaseAllowed,
    true
  );

  assert.equal(
    build.proposal
      .deploymentPlan
      ?.target
      .workflowVersion,
    "3"
  );

  assert.equal(
    build.proposal
      .deploymentPlan
      ?.retireGate
      ?.ready,
    false
  );

  assert.equal(
    build.proposal
      .migrationPlan
      ?.verification
      .passed,
    true
  );

  assert.equal(
    build.proposal
      .contractCompatibility
      ?.runtimePayloadChecks
      .some(
        item =>
          item.surfaceKind ===
            "hr.leave.manager-approval" &&
          item.samples === 1 &&
          item.compatible
      ),
    true
  );

  assert.equal(
    build.proposal
      .changeSet
      ?.items
      .some(
        item =>
          item.kind ===
            "workflow" &&
          item.id ===
            "hr.leave.request" &&
          item.change ===
            "modify" &&
          item.before
            ?.version ===
            "2" &&
          item.after
            ?.version ===
            "3"
      ),
    true
  );

  const generatedWorkflow =
    build.proposal
      .artifacts
      .find(
        item =>
          item.path ===
          "src/workflows/leave.ts"
      )
      ?.content ??
    "";

  assert.match(
    generatedWorkflow,
    /version:\s*"3"/
  );

  assert.match(
    generatedWorkflow,
    /input\.days > 2/
  );

  assert.doesNotMatch(
    generatedWorkflow,
    /version:\s*"2"/
  );

  console.log(
    JSON.stringify(
      {
        graph: {
          packages:
            inventory.packages,
          workflows:
            inventory.workflows,
          capabilities:
            inventory.capabilities,
          surfaces:
            inventory.surfaces
        },
        runtimeImpact:
          impact,
        builderTargetVersion:
          build.plan
            .workflowVersions[
              "hr.leave.request"
            ],
        builderRisk:
          build.proposal
            .impact
            .activeExecutionRisk,
        changeSummary:
          build.proposal
            .changeSet
            ?.summary,
        changeSafety:
          build.proposal
            .changeSafety,
        contractCompatibility:
          build.proposal
            .contractCompatibility,
        migrationPlan:
          build.proposal
            .migrationPlan,
        deploymentPlan:
          build.proposal
            .deploymentPlan
      },
      null,
      2
    )
  );

  console.log(
    "UAIR ProjectGraph + runtime impact verification: PASS"
  );
} finally {
  await rm(
    project,
    {
      recursive: true,
      force: true
    }
  );

  await rm(
    runtimeDir,
    {
      recursive: true,
      force: true
    }
  );
}
