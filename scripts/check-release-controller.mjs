import assert from "node:assert/strict";

import {
  cp,
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  runCli
} from "../packages/cli/dist/index.js";

const project =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-cli-project-"
    )
  );

try {
  await cp(
    "examples/builder-showcase/fixture",
    project,
    {
      recursive: true
    }
  );

  const storage =
    new JsonFileStorage(
      join(
        project,
        ".uair/runtime"
      )
    );

  await storage.saveExecution({
    id:
      "leave-running-v2",
    workflow:
      "hr.leave.request",
    workflowVersion:
      "2",
    deploymentId:
      "deploy-leave-v2",
    input: {},
    status:
      "running",
    history: []
  });

  await storage.saveExecution({
    id:
      "leave-suspended-v2",
    workflow:
      "hr.leave.request",
    workflowVersion:
      "2",
    deploymentId:
      "deploy-leave-v2",
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
              days:
                5,
              reason:
                "家庭安排"
            },
            balance: {
              remaining:
                12
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

  const stdout =
    [];

  const stderr =
    [];

  const io = {
    stdout(value) {
      stdout.push(
        value
      );
    },
    stderr(value) {
      stderr.push(
        value
      );
    }
  };

  let code =
    await runCli(
      [
        "build",
        "--requirement",
        "修改现有请假系统：所有请假直属经理审批，超过2天就要追加部门负责人审批，余额不足不能提交，审批后写入考勤并审计。",
        "--scope",
        "acme",
        "--package",
        "@acme/leave",
        "--backend",
        "deterministic"
      ],
      {
        cwd:
          project,
        io
      }
    );

  if (
    code !== 0
  ) {
    console.error(
      "BUILD STDERR:",
      stderr.at(-1)
    );
  }

  assert.equal(
    code,
    0
  );

  const build =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    build.proposal
      .targetVersion,
    "3"
  );

  const generatedWorkflow =
    await readFile(
      join(
        build.candidateDir,
        "src/workflows/leave.ts"
      ),
      "utf8"
    );

  const generatedComponents =
    await readFile(
      join(
        build.candidateDir,
        "src/components/index.ts"
      ),
      "utf8"
    );

  assert.match(
    generatedWorkflow,
    /auditAppend as appendAudit/
  );

  assert.match(
    generatedWorkflow,
    /from "@acme\/platform"/
  );

  assert.doesNotMatch(
    generatedComponents,
    /"audit\.append"/,
    "Builder must reuse an existing cross-package durable Component instead of redeclaring its ID"
  );

  code =
    await runCli(
      [
        "review"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const review =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    review.deploymentReady,
    true
  );

  assert.equal(
    review.runtimeRisk,
    "high"
  );

  code =
    await runCli(
      [
        "release"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    1,
    "release must require explicit approval"
  );

  assert.match(
    stderr.pop(),
    /explicit approval/
  );

  code =
    await runCli(
      [
        "release",
        "--approve"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const released =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    released.released
      .workflowVersion,
    "3"
  );

  code =
    await runCli(
      [
        "status"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const beforeDrain =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    beforeDrain.phase,
    "released"
  );

  assert.equal(
    beforeDrain
      .retireReady,
    false
  );

  code =
    await runCli(
      [
        "retire",
        "--approve"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    1,
    "retirement must be blocked before old executions drain"
  );

  assert.match(
    stderr.pop(),
    /Retire gate is not ready/
  );

  const running =
    await storage.loadExecution(
      "leave-running-v2"
    );

  const suspended =
    await storage.loadExecution(
      "leave-suspended-v2"
    );

  running.status =
    "completed";

  running.result = {
    approved:
      true
  };

  suspended.status =
    "completed";

  suspended.result = {
    approved:
      true
  };

  await storage.saveExecution(
    running
  );

  await storage.saveExecution(
    suspended
  );

  code =
    await runCli(
      [
        "status"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const afterDrain =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    afterDrain
      .retireReady,
    true
  );

  code =
    await runCli(
      [
        "retire",
        "--approve"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const retired =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    retired.retired
      .workflowVersion,
    "2"
  );

  code =
    await runCli(
      [
        "status"
      ],
      {
        cwd:
          project,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const final =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    final.phase,
    "retired"
  );

  console.log(
    JSON.stringify(
      {
        build:
          build.proposal,
        review: {
          deploymentReady:
            review.deploymentReady,
          runtimeRisk:
            review.runtimeRisk
        },
        beforeDrain: {
          phase:
            beforeDrain.phase,
          retireReady:
            beforeDrain.retireReady
        },
        afterDrain: {
          retireReady:
            afterDrain.retireReady
        },
        retirement:
          retired.retired,
        finalPhase:
          final.phase
      },
      null,
      2
    )
  );

  console.log(
    "UAIR CLI + ReleaseController end-to-end verification: PASS"
  );
} finally {
  await rm(
    project,
    {
      recursive: true,
      force: true
    }
  );
}
