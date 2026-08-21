import assert from "node:assert/strict";

import {
  chmod,
  cp,
  mkdir,
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
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  createBuilderWorkflow,
  createCodexBuilderDefaults,
  materializeArtifacts
} from "../packages/builder/dist/index.js";

const project =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-codex-project-"
    )
  );

const trace =
  join(
    project,
    "codex-trace.jsonl"
  );

const fakeCodex =
  new URL(
    "./fake-codex.mjs",
    import.meta.url
  ).pathname;

// Source archives do not have to preserve Unix executable metadata.
// Make the protocol fixture executable as part of the test setup so the
// release gate is reproducible after npm/git/zip transport.
await chmod(
  fakeCodex,
  0o755
);

try {
  await cp(
    "examples/builder-showcase/fixture",
    project,
    {
      recursive: true
    }
  );

  await symlink(
    join(
      process.cwd(),
      "node_modules"
    ),
    join(
      project,
      "node_modules"
    ),
    "dir"
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

  const previousTrace =
    process.env
      .FAKE_CODEX_TRACE;

  process.env
    .FAKE_CODEX_TRACE =
    trace;

  try {
    const builder =
      createBuilderWorkflow(
        createCodexBuilderDefaults(
          project,
          storage,
          {
            binary:
              fakeCodex,
            model:
              "gpt-5.6-sol"
          }
        )
      );

    const execution =
      await run(
        builder,
        {
          description:
            "修改现有请假系统：所有请假直属经理审批，超过2天就要追加部门负责人审批，余额不足不能提交，审批后写入考勤并审计。",
          companyScope:
            "acme",
          packageName:
            "@acme/leave"
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
      result.spec
        .packageName,
      "@acme/leave"
    );

    assert.equal(
      result.plan
        .workflowVersions[
          "hr.leave.request"
        ],
      "3"
    );

    const workflow =
      result.proposal
        .artifacts
        .find(
          item =>
            item.path ===
            "src/workflows/leave.ts"
        )
        ?.content ??
      "";

    assert.match(
      workflow,
      /version:\s*"3"/
    );

    assert.match(
      workflow,
      /input\.days > 2/
    );

    assert.equal(
      result.proposal
        .changeSafety
        ?.safe,
      true
    );

    assert.equal(
      result.proposal
        .contractCompatibility
        ?.compatible,
      true
    );

    assert.equal(
      result.proposal
        .migrationPlan
        ?.selected,
      "version-isolation"
    );

    assert.equal(
      result.proposal
        .deploymentPlan
        ?.target
        .workflowVersion,
      "3"
    );


    const candidate =
      join(
        project,
        ".candidate"
      );

    await materializeArtifacts(
      candidate,
      result.proposal
        .artifacts
    );

    const rootNodeModules =
      join(
        process.cwd(),
        "node_modules"
      );

    const acmeScope =
      join(
        rootNodeModules,
        "@acme"
      );

    await mkdir(
      acmeScope,
      {
        recursive:
          true
      }
    );

    const platformLink =
      join(
        acmeScope,
        "platform"
      );

    await rm(
      platformLink,
      {
        recursive:
          true,
        force:
          true
      }
    );

    await symlink(
      join(
        project,
        "packages",
        "platform"
      ),
      platformLink,
      "dir"
    );

    await symlink(
      rootNodeModules,
      join(
        candidate,
        "node_modules"
      ),
      "dir"
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
            candidate,
          encoding:
            "utf8"
        }
      );

    if (
      compile.status !==
        0
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
      "Codex-generated candidate package must compile"
    );

    const lines =
      (
        await readFile(
          trace,
          "utf8"
        )
      )
        .trim()
        .split(
          "\n"
        )
        .map(
          line =>
            JSON.parse(
              line
            )
        );

    assert.equal(
      lines.length,
      3,
      "Codex must be called exactly once for Analyst, Architect and Implementer"
    );

    for (
      const call
      of lines
    ) {
      assert.equal(
        call.args[0],
        "exec"
      );

      assert.equal(
        call.args.includes(
          "--ephemeral"
        ),
        true
      );

      assert.equal(
        call.args.includes(
          "--output-schema"
        ),
        true
      );

      assert.equal(
        call.args.includes(
          "--output-last-message"
        ),
        true
      );

      assert.equal(
        call.args.includes(
          "--model"
        ),
        true
      );

      assert.equal(
        call.args.includes(
          "gpt-5.6-sol"
        ),
        true
      );
    }

    assert.match(
      lines[0].prompt,
      /RequirementAnalyst phase/
    );

    assert.match(
      lines[1].prompt,
      /SolutionArchitect phase/
    );

    assert.match(
      lines[2].prompt,
      /coding implementation phase/
    );

    console.log(
      JSON.stringify(
        {
          codexCalls:
            lines.length,
          targetVersion:
            result.plan
              .workflowVersions[
                "hr.leave.request"
              ],
          generatedWorkflow:
            "hr.leave.request@3",
          changeSafe:
            result.proposal
              .changeSafety
              ?.safe,
          contractCompatible:
            result.proposal
              .contractCompatibility
              ?.compatible,
          migration:
            result.proposal
              .migrationPlan
              ?.selected,
          deploymentTarget:
            result.proposal
              .deploymentPlan
              ?.target
              .deploymentId,
          candidateCompile:
            "PASS"
        },
        null,
        2
      )
    );

    console.log(
      "UAIR Codex CLI backend protocol + full Builder verification: PASS"
    );
  } finally {
    if (
      previousTrace ===
        undefined
    ) {
      delete process.env
        .FAKE_CODEX_TRACE;
    } else {
      process.env
        .FAKE_CODEX_TRACE =
        previousTrace;
    }
  }
} finally {
  await rm(
    join(
      process.cwd(),
      "node_modules",
      "@acme",
      "platform"
    ),
    {
      recursive: true,
      force: true
    }
  );

  await rm(
    project,
    {
      recursive: true,
      force: true
    }
  );
}
