import assert from "node:assert/strict";
import {
  mkdtemp,
  rm
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
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  createBuilderWorkflow,
  createDeterministicBuilderDefaults,
  materializeArtifacts
} from "../packages/builder/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-builder-"
    )
  );

try {
  const defaults =
    createDeterministicBuilderDefaults({
      packages: [
        "@acme/platform"
      ],
      capabilities: [
        "employee.lookup",
        "audit.append"
      ],
      workflows: [],
      surfaces: []
    });

  const builder =
    createBuilderWorkflow(
      defaults
    );

  const storage =
    new JsonFileStorage(
      join(
        dir,
        "state"
      )
    );

  const execution =
    await run(
      builder,
      {
        description:
          "给我们公司做一套请假系统：所有请假直属经理审批，超过3天部门负责人追加审批，余额不足不能提交，审批后写入考勤并审计。",
        companyScope:
          "acme"
      },
      storage
    );

  assert.equal(
    execution.status,
    "completed"
  );

  const result =
    execution.result;

  assert.equal(
    result.spec.packageName,
    "@acme/leave"
  );

  assert.equal(
    result.spec.workflows[0].id,
    "hr.leave.request"
  );

  assert.equal(
    result.plan.capabilities.find(
      item =>
        item.id ===
          "employee.lookup"
    ).source,
    "generate",
    "an inventory ID without provider package/export metadata is not safely reusable"
  );

  assert.equal(
    result.plan.capabilities.find(
      item =>
        item.id ===
          "attendance.update"
    ).source,
    "generate"
  );

  assert.equal(
    result.proposal.verification.passed,
    true
  );

  assert.equal(
    result.proposal.impact.activeExecutionRisk,
    "none"
  );

  assert.equal(
    result.proposal.artifacts.some(
      item =>
        item.path ===
          "src/workflows/leave.ts"
    ),
    true
  );

  assert.equal(
    result.proposal.preview.demoScenarios.length,
    3
  );


  const packageDir =
    await mkdtemp(
      join(
        process.cwd(),
        ".uair-builder-package-"
      )
    );

  try {
    const written =
      await materializeArtifacts(
        packageDir,
        result.proposal.artifacts
      );

    assert.equal(
      written.length,
      result.proposal.artifacts.length
    );

    const compile =
      spawnSync(
        "npx",
        [
          "tsc",
          "-p",
          "tsconfig.json",
          "--pretty",
          "false"
        ],
        {
          cwd:
            packageDir,
          encoding:
            "utf8"
        }
      );

    if (
      compile.status !== 0
    ) {
      console.error(
        compile.stdout
      );
      console.error(
        compile.stderr
      );
    }

    assert.equal(
      compile.status,
      0,
      "materialized company package must compile"
    );

    console.log(
      "Generated package compile: PASS"
    );
  } finally {
    await rm(
      packageDir,
      {
        recursive: true,
        force: true
      }
    );
  }

  console.log(
    JSON.stringify(
      {
        package:
          result.proposal.packageName,
        version:
          result.proposal.version,
        workflows:
          result.plan.workflowIds,
        surfaces:
          result.plan.surfaceKinds,
        reusedCapabilities:
          result.plan.capabilities
            .filter(
              item =>
                item.source ===
                  "existing"
            )
            .map(
              item =>
                item.id
            ),
        generatedCapabilities:
          result.plan.capabilities
            .filter(
              item =>
                item.source ===
                  "generate"
            )
            .map(
              item =>
                item.id
            ),
        artifacts:
          result.proposal.artifacts
            .map(
              item =>
                item.path
            ),
        tests:
          result.plan.tests
            .map(
              item =>
                item.id
            )
      },
      null,
      2
    )
  );

  console.log(
    "UAIR Builder fixed-business package generation verification: PASS"
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
