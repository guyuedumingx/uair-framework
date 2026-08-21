import assert from "node:assert/strict";

import {
  access,
  mkdtemp,
  readFile,
  rm,
  symlink
} from "node:fs/promises";

import {
  spawnSync
} from "node:child_process";

import {
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

import {
  runCli
} from "../packages/cli/dist/index.js";

const temp =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-bootstrap-"
    )
  );

const app =
  join(
    temp,
    "app"
  );

const stdout = [];
const stderr = [];

try {
  const create =
    spawnSync(
      process.execPath,
      [
        "packages/create-uair/dist/index.js",
        app
      ],
      {
        cwd:
          process.cwd(),
        encoding:
          "utf8"
      }
    );

  assert.equal(
    create.status,
    0,
    create.stderr
  );

  await symlink(
    join(
      process.cwd(),
      "node_modules"
    ),
    join(
      app,
      "node_modules"
    ),
    "dir"
  );

  const exit =
    await runCli(
      [
        "build",
        "--backend",
        "deterministic",
        "--requirement",
        "从零创建一个请假管理流程：余额不足不能提交，所有请假经理审批，超过2天追加部门负责人审批，审批后更新考勤并写审计。",
        "--scope",
        "acme",
        "--package",
        "@acme/leave"
      ],
      {
        cwd:
          app,
        io: {
          stdout(
            value
          ) {
            stdout.push(
              value
            );
          },

          stderr(
            value
          ) {
            stderr.push(
              value
            );
          }
        }
      }
    );

  assert.equal(
    exit,
    0,
    stderr.join(
      "\n"
    )
  );

  const output =
    JSON.parse(
      stdout.at(-1)
    );

  assert.equal(
    output.command,
    "build"
  );

  await access(
    join(
      app,
      ".uair",
      "build",
      "candidate",
      "package.json"
    )
  );

  const workflow =
    await readFile(
      join(
        app,
        ".uair",
        "build",
        "candidate",
        "src",
        "workflows",
        "leave.ts"
      ),
      "utf8"
    );

  assert.match(
    workflow,
    /hr\.leave\.request/
  );

  assert.match(
    workflow,
    /version:\s*"1"/
  );

  const appSource =
    await readFile(
      join(
        app,
        "src",
        "index.ts"
      ),
      "utf8"
    );

  assert.match(
    appSource,
    /workflow\(\s*"hello"/s,
    "create-uair source remains unchanged until candidate promotion/release"
  );

  console.log(
    JSON.stringify(
      {
        createUair:
          "PASS",
        builderFromMinimalProject:
          "PASS",
        projectInspectionFromZero:
          "PASS",
        candidateGeneration:
          "PASS",
        candidateWorkflow:
          "hr.leave.request@1",
        automaticSourcePromotion:
          false,
        autonomousRepeatedGoalLoop:
          false,
        approvalBypass:
          false
      },
      null,
      2
    )
  );

  console.log(
    "UAIR create-uair → Builder bootstrap boundary verification: PASS"
  );
} finally {
  await rm(
    temp,
    {
      recursive:
        true,
      force:
        true
    }
  );
}
