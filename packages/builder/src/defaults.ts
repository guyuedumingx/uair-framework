import type {
  ArtifactImplementer,
  ArtifactVerifier,
  ImpactAnalyzer,
  PreviewBuilder,
  ProjectInspector,
  ReleasePlanner,
  RequirementAnalyst,
  SolutionArchitect
} from "./interfaces.js";

import type {
  Storage
} from "@uair/core/runtime";

import type {
  CapabilityResolver
} from "@uair/package";

import {
  ResolverBackedCapabilityPlanner
} from "./capability-resolution.js";

import {
  FsProjectGraphInspector
} from "./project-graph.js";

import {
  DurableRuntimeImpactAnalyzer
} from "./runtime-impact.js";

import {
  FilesystemChangeAnalyzer
} from "./filesystem-change-analyzer.js";

import {
  ConservativeMigrationPlanner
} from "./migration-planner.js";

import {
  ConservativeDeploymentPlanner
} from "./deployment-planner.js";

import {
  CodexArtifactImplementer,
  CodexCliClient,
  CodexRequirementAnalyst,
  CodexSolutionArchitect,
  type CodexCliOptions
} from "./codex-cli-backend.js";

import type {
  BusinessSpec,
  BuildPlan,
  GeneratedArtifact,
  ProjectInventory,
  RequirementRequest
} from "./types.js";

function slug(
  value: string
) {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9._-]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}

function detectLeave(
  description: string
) {
  return /请假|leave/i
    .test(
      description
    );
}

export class StaticProjectInspector
  implements ProjectInspector {
  constructor(
    private readonly inventory:
      ProjectInventory = {
        packages: [],
        capabilities: [],
        workflows: [],
        surfaces: []
      }
  ) {}

  async inspect() {
    return structuredClone(
      this.inventory
    );
  }
}

/**
 * Deterministic reference analyst.
 *
 * A real LLM can implement the same interface. Keeping a deterministic
 * implementation is useful for tests and Builder protocol verification.
 */
export class DeterministicRequirementAnalyst
  implements RequirementAnalyst {
  async analyze(
    request:
      RequirementRequest,
    _inventory:
      ProjectInventory
  ): Promise<BusinessSpec> {
    const scope =
      request.companyScope ??
      "company";

    if (
      detectLeave(
        request.description
      )
    ) {
      const directorThreshold =
        Number(
          request.description
            .match(
              /超过\s*(\d+)\s*天/
            )?.[1] ??
          "3"
        );

      return {
        applicationId:
          `${scope}.hr.leave`,
        name:
          "请假管理",
        packageName:
          request.packageName ??
          `@${scope}/leave`,
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
              `请假超过 ${directorThreshold} 天必须追加部门负责人审批`
          }
        ],
        capabilities: [
          {
            id:
              "employee.lookup",
            description:
              "读取员工和直属关系",
            required:
              true
          },
          {
            id:
              "leave.balance.read",
            description:
              "读取剩余请假余额",
            required:
              true
          },
          {
            id:
              "attendance.update",
            description:
              "审批后写入考勤系统",
            required:
              true
          },
          {
            id:
              "audit.append",
            description:
              "写入不可变审计记录",
            required:
              true
          }
        ],
        surfaces: [
          {
            kind:
              "hr.leave.form",
            purpose:
              "员工提交请假申请",
            blocking:
              true
          },
          {
            kind:
              "hr.leave.manager-approval",
            purpose:
              "直属经理审批",
            blocking:
              true
          },
          {
            kind:
              "hr.leave.director-approval",
            purpose:
              "部门负责人审批",
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
    }

    const base =
      slug(
        request.description
      ) ||
      "application";

    return {
      applicationId:
        `${scope}.${base}`,
      name:
        request.description,
      packageName:
        request.packageName ??
        `@${scope}/${base}`,
      actors: [],
      rules: [],
      capabilities: [],
      surfaces: [],
      workflows: [
        {
          id:
            `${base}.main`,
          description:
            request.description,
          actors: [],
          rules: [],
          effects: []
        }
      ]
    };
  }
}

function nextWorkflowVersion(
  current?: string
) {
  if (!current) {
    return "1";
  }

  if (
    /^\d+$/.test(
      current
    )
  ) {
    return String(
      Number(current) +
      1
    );
  }

  return `${current}.next`;
}

export class DeterministicSolutionArchitect
  implements SolutionArchitect {
  async plan(
    spec:
      BusinessSpec,
    inventory:
      ProjectInventory
  ): Promise<BuildPlan> {
    const existing =
      new Set(
        inventory
          .capabilities
      );

    const capabilities =
      spec.capabilities
        .map(
          item => {
            const provider =
              inventory
                .capabilityProviders
                ?.[item.id];

            const reused =
              existing.has(
                item.id
              ) &&
              Boolean(
                provider
                  ?.packageName &&
                provider
                  ?.exportName
              ) &&
              provider!
                .packageName !==
                spec.packageName;

            return {
              id:
                item.id,
              source:
                reused
                  ? "existing" as const
                  : "generate" as const,
              detail:
                reused
                  ? "Reuse existing project capability"
                  : "Generate package-local adapter/component",
              providerPackage:
                reused
                  ? provider
                      ?.packageName
                  : undefined,
              exportName:
                reused
                  ? provider
                      ?.exportName
                  : undefined
            };
          }
        );

    const workflowVersions =
      Object.fromEntries(
        spec.workflows
          .map(
            workflow => {
              const current =
                inventory.workflows
                  .find(
                    item =>
                      item.id ===
                      workflow.id
                  );

              return [
                workflow.id,
                nextWorkflowVersion(
                  current?.version
                )
              ];
            }
          )
      );

    return {
      packageName:
        spec.packageName,
      workflowIds:
        spec.workflows
          .map(
            item =>
              item.id
          ),
      workflowVersions,
      componentIds:
        capabilities
          .filter(
            item =>
              item.source ===
                "generate"
          )
          .map(
            item =>
              item.id
          ),
      surfaceKinds:
        spec.surfaces
          .map(
            item =>
              item.kind
          ),
      capabilities,
      files: [
        {
          path:
            "src/workflows/leave.ts",
          purpose:
            "Durable business Workflow"
        },
        {
          path:
            "src/components/index.ts",
          purpose:
            "Capability Components"
        },
        {
          path:
            "src/surfaces.ts",
          purpose:
            "Surface semantic contracts"
        },
        {
          path:
            "src/index.ts",
          purpose:
            "Package exports"
        },
        {
          path:
            "test/leave.test.ts",
          purpose:
            "Business + durability tests"
        },
        {
          path:
            "tsconfig.json",
          purpose:
            "Standalone TypeScript build configuration"
        },
        {
          path:
            "package.json",
          purpose:
            "npm package metadata"
        }
      ],
      tests: [
        {
          id:
            "leave.2days",
          description:
            "2 天请假只要求直属经理审批",
          kind:
            "business"
        },
        {
          id:
            "leave.5days",
          description:
            "5 天请假要求经理 + 部门负责人审批",
          kind:
            "business"
        },
        {
          id:
            "leave.no-balance",
          description:
            "余额不足必须拒绝",
          kind:
            "business"
        },
        {
          id:
            "leave.resume",
          description:
            "审批等待期间进程重启后仍可恢复",
          kind:
            "durability"
        }
      ]
    };
  }
}

function tsconfigJson() {
  return JSON.stringify(
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
  ) + "\n";
}

function packageJson(
  spec:
    BusinessSpec,
  plan:
    BuildPlan
) {
  const providerDependencies =
    Object.fromEntries(
      plan.capabilities
        .filter(
          item =>
            (
              item.source ===
                "existing" ||
              item.source ===
                "install"
            ) &&
            item.providerPackage &&
            item.providerPackage !==
              spec.packageName
        )
        .map(
          item => [
            item.providerPackage!,
            item.providerVersion ??
            "*"
          ]
        )
    );

  return JSON.stringify(
    {
      name:
        spec.packageName,
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
        ...providerDependencies
      }
    },
    null,
    2
  ) + "\n";
}

function workflowSource(
  spec:
    BusinessSpec,
  plan:
    BuildPlan,
  version: string
) {
  const directorThreshold =
    Number(
      spec.rules
        .find(
          item =>
            item.id ===
            "leave.director"
        )
        ?.description
        .match(
          /超过\s*(\d+)\s*天/
        )?.[1] ??
      "3"
    );

  const bindings:
    Record<
      string,
      string
    > = {
      "leave.balance.read":
        "checkBalance",
      "attendance.update":
        "updateAttendance",
      "audit.append":
        "appendAudit"
    };

  const generatedNames =
    plan.capabilities
      .filter(
        item =>
          item.source ===
            "generate"
      )
      .map(
        item =>
          bindings[item.id]
      )
      .filter(Boolean);

  const localImport =
    generatedNames.length
      ? `import {\n  ${generatedNames.join(",\n  ")}\n} from "../components/index.js";\n`
      : "";

  const providerImports =
    plan.capabilities
      .filter(
        item =>
          (
            item.source ===
              "existing" ||
            item.source ===
              "install"
          ) &&
          item.providerPackage &&
          item.exportName
      )
      .map(
        item => {
          const local =
            bindings[item.id];

          return local
            ? `import { ${item.exportName} as ${local} } from "${item.providerPackage}";`
            : `import { ${item.exportName} } from "${item.providerPackage}";`;
        }
      )
      .join("\n");

  return `import {
  workflow
} from "@uair/core";
import {
  surface
} from "@uair/ui";

${localImport}${providerImports}${providerImports ? "\n" : ""}
export const leaveRequest =
  workflow({
    id: "hr.leave.request",
    version: "${version}",

    async run(input: {
      employeeId: string;
      days: number;
      reason: string;
    }) {
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
        await appendAudit({
          action:
            "manager_rejected",
          input
        });

        return {
          approved: false,
          reason:
            "manager_rejected"
        };
      }

      if (
        input.days > ${directorThreshold}
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
          await appendAudit({
            action:
              "director_rejected",
            input
          });

          return {
            approved: false,
            reason:
              "director_rejected"
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
`;
}

function componentsSource(
  plan:
    BuildPlan
) {
  const generated =
    new Set(
      plan.capabilities
        .filter(
          item =>
            item.source ===
              "generate"
        )
        .map(
          item =>
            item.id
        )
    );

  const blocks:
    string[] = [];

  if (
    generated.has(
      "leave.balance.read"
    )
  ) {
    blocks.push(`export const checkBalance =
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
  });`);
  }

  if (
    generated.has(
      "attendance.update"
    )
  ) {
    blocks.push(`export const updateAttendance =
  component({
    id:
      "attendance.update",

    async run(input: unknown) {
      return {
        updated: true,
        input
      };
    }
  });`);
  }

  if (
    generated.has(
      "audit.append"
    )
  ) {
    blocks.push(`export const appendAudit =
  component({
    id:
      "audit.append",

    async run(input: unknown) {
      return {
        immutable: true,
        input
      };
    }
  });`);
  }

  const known =
    new Set([
      "leave.balance.read",
      "attendance.update",
      "audit.append"
    ]);

  for (
    const id
    of generated
  ) {
    if (
      known.has(
        id
      )
    ) {
      continue;
    }

    const exportName =
      `generated_${id
        .replace(
          /[^a-zA-Z0-9_$]+/g,
          "_"
        )
        .replace(
          /^[^a-zA-Z_$]/,
          "_"
        )}`;

    blocks.push(`export const ${exportName} =
  component({
    id:
      ${JSON.stringify(id)},

    async run(input: unknown) {
      return {
        generated: true,
        input
      };
    }
  });`);
  }

  return `import {
  component
} from "@uair/core";

${blocks.join("\n\n")}
`;
}

function surfacesSource() {
  return `export const leaveSurfaces = {
  form:
    "hr.leave.form",
  managerApproval:
    "hr.leave.manager-approval",
  directorApproval:
    "hr.leave.director-approval"
} as const;
`;
}

function testSource() {
  return `import {
  describe,
  it
} from "node:test";
import assert from "node:assert/strict";

describe(
  "leave package",
  () => {
    it(
      "declares durable workflow identity",
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
      }
    );
  }
);
`;
}

export class DeterministicArtifactImplementer
  implements ArtifactImplementer {
  async implement(
    spec:
      BusinessSpec,
    plan:
      BuildPlan
  ): Promise<
    GeneratedArtifact[]
  > {
    return [
      {
        path:
          "package.json",
        content:
          packageJson(
            spec,
            plan
          )
      },
      {
        path:
          "src/workflows/leave.ts",
        content:
          workflowSource(
            spec,
            plan,
            plan.workflowVersions[
              "hr.leave.request"
            ] ??
            "1"
          )
      },
      {
        path:
          "src/components/index.ts",
        content:
          componentsSource(
            plan
          )
      },
      {
        path:
          "src/surfaces.ts",
        content:
          surfacesSource()
      },
      {
        path:
          "src/index.ts",
        content:
          `export * from "./workflows/leave.js";\nexport * from "./components/index.js";\nexport * from "./surfaces.js";\n`
      },
      {
        path:
          "test/leave.test.ts",
        content:
          testSource()
      },
      {
        path:
          "tsconfig.json",
        content:
          tsconfigJson()
      }
    ];
  }
}

export class StructuralArtifactVerifier
  implements ArtifactVerifier {
  async verify(
    spec:
      BusinessSpec,
    plan:
      BuildPlan,
    artifacts:
      GeneratedArtifact[]
  ) {
    const paths =
      new Set(
        artifacts.map(
          item =>
            item.path
        )
      );

    const generatedCapabilityIds =
      plan.capabilities
        .filter(
          item =>
            item.source ===
              "generate"
        )
        .map(
          item =>
            item.id
        );

    const externallyResolved =
      plan.capabilities
        .filter(
          item =>
            item.source !==
              "generate"
        );

    const checks = [
      {
        id:
          "generated-capabilities-materialized",
        passed:
          generatedCapabilityIds
            .every(
              id =>
                artifacts.some(
                  item =>
                    item.content
                      .includes(
                        JSON.stringify(
                          id
                        )
                      )
                )
            ),
        message:
          "all generated required capabilities are materially declared in candidate source"
      },
      {
        id:
          "external-capabilities-resolved",
        passed:
          externallyResolved
            .every(
              item =>
                item.source ===
                  "mcp" ||
                Boolean(
                  item.providerPackage
                )
            ),
        message:
          "all reused/install/MCP capabilities have an explicit provider"
      },
      {
        id:
          "package-json",
        passed:
          paths.has(
            "package.json"
          ),
        message:
          "package.json generated"
      },
      {
        id:
          "workflow",
        passed:
          plan.workflowIds
            .every(
              workflowId => {
                const escaped =
                  workflowId
                    .replace(
                      /[.*+?^${}()|[\]\\]/g,
                      "\\$&"
                    );

                const identity =
                  new RegExp(
                    `\\bid\\s*:\\s*["'\\\`]${escaped}["'\\\`]`
                  );

                return artifacts
                  .some(
                    item =>
                      identity.test(
                        item.content
                      )
                  );
              }
            ),
        message:
          "all stable Workflow IDs generated"
      },
      {
        id:
          "surfaces",
        passed:
          plan.surfaceKinds
            .every(
              kind =>
                artifacts.some(
                  item =>
                    item.content
                      .includes(
                        kind
                      )
                )
            ),
        message:
          "all semantic Surface kinds represented"
      },
      {
        id:
          "tests",
        passed:
          artifacts.some(
            item =>
              item.path.startsWith(
                "test/"
              )
          ),
        message:
          "test artifact generated"
      },
      {
        id:
          "package-name",
        passed:
          artifacts.some(
            item =>
              item.content.includes(
                spec.packageName
              )
          ),
        message:
          "package identity represented"
      }
    ];

    return {
      passed:
        checks.every(
          check =>
            check.passed
        ),
      checks
    };
  }
}

export class ConservativeImpactAnalyzer
  implements ImpactAnalyzer {
  async analyze(
    spec:
      BusinessSpec,
    _plan:
      BuildPlan,
    inventory:
      ProjectInventory
  ) {
    const existing =
      inventory.workflows
        .filter(
          item =>
            spec.workflows
              .some(
                workflow =>
                  workflow.id ===
                  item.id
              )
        );

    return {
      activeExecutionRisk:
        existing.length
          ? "medium" as const
          : "none" as const,
      versionRecommendation:
        existing.length
          ? "Create a new Workflow version and preserve existing executions"
          : "Start at Workflow version 1",
      notes:
        existing.length
          ? [
              "Existing durable Workflow identity detected",
              "Do not overwrite code under the existing version"
            ]
          : [
              "No existing Workflow identity collision detected"
            ]
    };
  }
}

export class DeterministicPreviewBuilder
  implements PreviewBuilder {
  async build(
    spec:
      BusinessSpec,
    plan:
      BuildPlan,
    _artifacts:
      GeneratedArtifact[]
  ) {
    return {
      packageName:
        spec.packageName,
      entryWorkflow:
        plan.workflowIds[0] ??
        "",
      surfaces:
        plan.surfaceKinds,
      capabilities:
        plan.capabilities
          .map(
            item =>
              item.id
          ),
      demoScenarios: [
        {
          name:
            "2 天请假",
          input: {
            employeeId:
              "E1001",
            days: 2,
            reason:
              "个人事务"
          },
          expected:
            "Manager approval only"
        },
        {
          name:
            "5 天请假",
          input: {
            employeeId:
              "E1001",
            days: 5,
            reason:
              "家庭安排"
          },
          expected:
            "Manager + director approvals"
        },
        {
          name:
            "余额不足",
          input: {
            employeeId:
              "E1001",
            days: 99,
            reason:
              "测试"
          },
          expected:
            "Rejected before approval"
        }
      ]
    };
  }
}

export class AlphaReleasePlanner
  implements ReleasePlanner {
  async propose(
    input:
      Parameters<
        ReleasePlanner["propose"]
      >[0]
  ) {
    return {
      packageName:
        input.spec
          .packageName,
      version:
        "0.1.0",
      artifacts:
        input.artifacts,
      preview:
        input.preview,
      verification:
        input.verification,
      impact:
        input.impact,
      changeSet:
        input.changeSet,
      changeSafety:
        input.changeSafety,
      contractCompatibility:
        input.contractCompatibility,
      architectureGovernance:
        input.architectureGovernance,
      capabilityResolution:
        input.capabilityResolution,
      extensionPlan:
        input.extensionPlan,
      migrationPlan:
        input.migrationPlan,
      deploymentPlan:
        input.deploymentPlan,
      permissions:
        input.plan
          .capabilities
          .map(
            item =>
              item.id
          )
    };
  }
}

export function createDeterministicBuilderDefaults(
  inventory:
    ProjectInventory = {
      packages: [],
      capabilities: [],
      workflows: [],
      surfaces: []
    }
) {
  return {
    inspector:
      new StaticProjectInspector(
        inventory
      ),
    analyst:
      new DeterministicRequirementAnalyst(),
    architect:
      new DeterministicSolutionArchitect(),
    implementer:
      new DeterministicArtifactImplementer(),
    verifier:
      new StructuralArtifactVerifier(),
    impact:
      new ConservativeImpactAnalyzer(),
    preview:
      new DeterministicPreviewBuilder(),
    release:
      new AlphaReleasePlanner()
  };
}


export function createProjectAwareBuilderDefaults(
  projectRoot: string,
  storage:
    Pick<
      Storage,
      "listExecutions"
    >,
  options: {
    capabilityResolver?:
      CapabilityResolver;
  } = {}
) {
  return {
    inspector:
      new FsProjectGraphInspector(
        projectRoot
      ),
    analyst:
      new DeterministicRequirementAnalyst(),
    architect:
      new DeterministicSolutionArchitect(),
    capabilities:
      options.capabilityResolver
        ? new ResolverBackedCapabilityPlanner(
            options.capabilityResolver
          )
        : undefined,
    implementer:
      new DeterministicArtifactImplementer(),
    verifier:
      new StructuralArtifactVerifier(),
    changes:
      new FilesystemChangeAnalyzer(
        projectRoot,
        storage
      ),
    impact:
      new DurableRuntimeImpactAnalyzer(
        storage
      ),
    migration:
      new ConservativeMigrationPlanner(),
    deployment:
      new ConservativeDeploymentPlanner(),
    preview:
      new DeterministicPreviewBuilder(),
    release:
      new AlphaReleasePlanner()
  };
}


export function createCodexBuilderDefaults(
  projectRoot: string,
  storage:
    Pick<
      Storage,
      "listExecutions"
    >,
  options:
    CodexCliOptions & {
      capabilityResolver?:
        CapabilityResolver;
    } = {}
) {
  const codex =
    new CodexCliClient(
      options
    );

  return {
    inspector:
      new FsProjectGraphInspector(
        projectRoot
      ),
    analyst:
      new CodexRequirementAnalyst(
        codex,
        projectRoot
      ),
    architect:
      new CodexSolutionArchitect(
        codex,
        projectRoot
      ),
    capabilities:
      options.capabilityResolver
        ? new ResolverBackedCapabilityPlanner(
            options.capabilityResolver
          )
        : undefined,
    implementer:
      new CodexArtifactImplementer(
        codex,
        projectRoot
      ),
    verifier:
      new StructuralArtifactVerifier(),
    changes:
      new FilesystemChangeAnalyzer(
        projectRoot,
        storage
      ),
    impact:
      new DurableRuntimeImpactAnalyzer(
        storage
      ),
    migration:
      new ConservativeMigrationPlanner(),
    deployment:
      new ConservativeDeploymentPlanner(),
    preview:
      new DeterministicPreviewBuilder(),
    release:
      new AlphaReleasePlanner()
  };
}
