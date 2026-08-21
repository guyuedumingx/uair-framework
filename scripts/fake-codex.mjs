#!/usr/bin/env node

import {
  appendFile,
  readFile,
  writeFile
} from "node:fs/promises";

const args =
  process.argv.slice(2);

if (
  args.includes(
    "--version"
  )
) {
  console.log(
    "codex-cli 0.fake"
  );

  process.exit(0);
}

if (
  args[0] !==
    "exec"
) {
  console.error(
    "fake codex expects exec"
  );

  process.exit(2);
}

for (
  const required
  of [
    "--ephemeral",
    "--output-schema",
    "--output-last-message"
  ]
) {
  if (
    !args.includes(
      required
    )
  ) {
    console.error(
      `missing ${required}`
    );

    process.exit(3);
  }
}

const outputIndex =
  args.indexOf(
    "--output-last-message"
  );

const outputFile =
  args[
    outputIndex + 1
  ];

let prompt =
  "";

for await (
  const chunk
  of process.stdin
) {
  prompt +=
    chunk.toString();
}

if (
  process.env
    .FAKE_CODEX_TRACE
) {
  await appendFile(
    process.env
      .FAKE_CODEX_TRACE,
    JSON.stringify({
      args,
      prompt
    }) +
    "\n"
  );
}

let result;

if (
  prompt.includes(
    "RequirementAnalyst phase"
  )
) {
  result = {
    applicationId:
      "acme.hr.leave",
    name:
      "请假管理",
    packageName:
      "@acme/leave",
    actors: [
      {
        id:
          "employee",
        label:
          "员工"
      },
      {
        id:
          "manager",
        label:
          "直属经理"
      },
      {
        id:
          "director",
        label:
          "部门负责人"
      }
    ],
    rules: [
      {
        id:
          "leave.balance",
        description:
          "请假天数不能超过可用余额"
      },
      {
        id:
          "leave.manager",
        description:
          "所有请假必须直属经理审批"
      },
      {
        id:
          "leave.director",
        description:
          "请假超过 2 天必须追加部门负责人审批"
      }
    ],
    capabilities: [
      {
        id:
          "employee.lookup",
        description:
          "读取员工关系",
        required:
          true
      },
      {
        id:
          "leave.balance.read",
        description:
          "读取请假余额",
        required:
          true
      },
      {
        id:
          "attendance.update",
        description:
          "写入考勤",
        required:
          true
      },
      {
        id:
          "audit.append",
        description:
          "审计",
        required:
          true
      }
    ],
    surfaces: [
      {
        kind:
          "hr.leave.form",
        purpose:
          "提交请假",
        blocking:
          true
      },
      {
        kind:
          "hr.leave.manager-approval",
        purpose:
          "经理审批",
        blocking:
          true
      },
      {
        kind:
          "hr.leave.director-approval",
        purpose:
          "负责人审批",
        blocking:
          true
      }
    ],
    workflows: [
      {
        id:
          "hr.leave.request",
        description:
          "固定请假审批流程",
        actors: [
          "employee",
          "manager",
          "director"
        ],
        rules: [
          "leave.balance",
          "leave.manager",
          "leave.director"
        ],
        effects: [
          "attendance.update",
          "audit.append"
        ]
      }
    ]
  };
} else if (
  prompt.includes(
    "SolutionArchitect phase"
  )
) {
  result = {
    packageName:
      "@acme/leave",
    workflowIds: [
      "hr.leave.request"
    ],
    workflowVersions: {
      "hr.leave.request":
        "3"
    },
    componentIds: [
      "leave.balance.read",
      "attendance.update"
    ],
    surfaceKinds: [
      "hr.leave.form",
      "hr.leave.manager-approval",
      "hr.leave.director-approval"
    ],
    capabilities: [
      {
        id:
          "employee.lookup",
        source:
          "existing",
        detail:
          "reuse platform provider",
        providerPackage:
          "@acme/platform",
        exportName:
          "employeeLookup"
      },
      {
        id:
          "leave.balance.read",
        source:
          "generate",
        detail:
          "preserve target-package capability"
      },
      {
        id:
          "attendance.update",
        source:
          "generate",
        detail:
          "fixture"
      },
      {
        id:
          "audit.append",
        source:
          "existing",
        detail:
          "reuse platform provider",
        providerPackage:
          "@acme/platform",
        exportName:
          "auditAppend"
      }
    ],
    files: [
      {
        path:
          "package.json",
        purpose:
          "npm package"
      },
      {
        path:
          "src/workflows/leave.ts",
        purpose:
          "Workflow"
      },
      {
        path:
          "src/components/index.ts",
        purpose:
          "Components"
      },
      {
        path:
          "src/surfaces.ts",
        content:
`export const leaveSurfaces = {
  form:
    "hr.leave.form",
  managerApproval:
    "hr.leave.manager-approval",
  directorApproval:
    "hr.leave.director-approval"
} as const;
`
      },
      {
        path:
          "src/index.ts",
        purpose:
          "exports"
      },
      {
        path:
          "tsconfig.json",
        purpose:
          "build"
      },
      {
        path:
          "test/leave.test.ts",
        purpose:
          "tests"
      }
    ],
    tests: [
      {
        id:
          "leave.threshold",
        description:
          "超过2天追加负责人审批",
        kind:
          "business"
      },
      {
        id:
          "leave.resume",
        description:
          "旧执行可恢复",
        kind:
          "durability"
      },
      {
        id:
          "leave.authz",
        description:
          "审批能力受权限约束",
        kind:
          "security"
      }
    ]
  };
} else if (
  prompt.includes(
    "coding implementation phase"
  )
) {
  result = {
    artifacts: [
      {
        path:
          "package.json",
        content:
          JSON.stringify(
            {
              name:
                "@acme/leave",
              version:
                "0.1.0",
              type:
                "module",
              license:
                "MIT",
              dependencies: {
                "@uair/core":
                  "^1.0.0-alpha",
                "@uair/ui":
                  "^1.0.0-alpha",
                "@acme/platform":
                  "^0.67.0"
              }
            },
            null,
            2
          ) +
          "\n"
      },
      {
        path:
          "src/components/index.ts",
        content:
`import {
  component
} from "@uair/core";

export const checkBalance =
  component({
    id:
      "leave.balance.read",

    async run(input: {
      employeeId: string;
    }) {
      return {
        remaining: 12
      };
    }
  });

export const updateAttendance =
  component({
    id:
      "attendance.update",

    async run(input: unknown) {
      return {
        updated: true,
        input
      };
    }
  });

`
      },
      {
        path:
          "src/workflows/leave.ts",
        content:
`import {
  workflow
} from "@uair/core";

import {
  surface
} from "@uair/ui";

import {
  checkBalance,
  updateAttendance
} from "../components/index.js";

import {
  auditAppend as appendAudit,
  employeeLookup
} from "@acme/platform";

export const leaveRequest =
  workflow({
    id:
      "hr.leave.request",
    version:
      "3",

    async run(input: {
      employeeId: string;
      days: number;
      reason: string;
    }) {
      await employeeLookup({
        employeeId:
          input.employeeId
      });

      const balance =
        await checkBalance({
          employeeId:
            input.employeeId
        });

      if (
        balance.remaining <
        input.days
      ) {
        return {
          approved: false,
          reason:
            "insufficient_balance"
        };
      }

      const manager =
        await surface({
          kind:
            "hr.leave.manager-approval",
          data: {
            input,
            balance
          }
        });

      if (
        manager.type !==
          "approve"
      ) {
        return {
          approved: false
        };
      }

      if (
        input.days > 2
      ) {
        const director =
          await surface({
            kind:
              "hr.leave.director-approval",
          data: {
            input
          }
        });

        if (
          director.type !==
            "approve"
        ) {
          return {
            approved: false
          };
        }
      }

      await updateAttendance(
        input
      );

      await appendAudit({
        action:
          "leave_approved",
        input
      });

      return {
        approved: true
      };
    }
  });
`
      },
      {
        path:
          "src/surfaces.ts",
        content:
`export const leaveSurfaces = {
  form:
    "hr.leave.form",
  managerApproval:
    "hr.leave.manager-approval",
  directorApproval:
    "hr.leave.director-approval"
} as const;
`
      },
      {
        path:
          "src/index.ts",
        content:
`export * from "./components/index.js";
export * from "./workflows/leave.js";
export * from "./surfaces.js";
`
      },
      {
        path:
          "test/leave.test.ts",
        content:
`import {
  test
} from "node:test";

import assert from "node:assert/strict";

test(
  "codex candidate exports v3 workflow",
  async () => {
    const {
      leaveRequest
    } =
      await import(
        "../src/workflows/leave.js"
      );

    assert.equal(
      leaveRequest.id,
      "hr.leave.request"
    );

    assert.equal(
      leaveRequest.version,
      "3"
    );
  }
);
`
      },
      {
        path:
          "tsconfig.json",
        content:
          JSON.stringify(
            {
              compilerOptions: {
                target:
                  "ES2022",
                module:
                  "NodeNext",
                moduleResolution:
                  "NodeNext",
                strict:
                  true,
                skipLibCheck:
                  true,
                outDir:
                  "dist",
                types: [
                  "node"
                ]
              },
              include: [
                "src/**/*.ts",
                "test/**/*.ts"
              ]
            },
            null,
            2
          ) +
          "\n"
      }
    ]
  };
} else {
  console.error(
    "unrecognized prompt"
  );

  process.exit(4);
}

await writeFile(
  outputFile,
  JSON.stringify(
    result,
    null,
    2
  ) +
  "\n",
  "utf8"
);

console.log(
  "fake codex completed"
);
