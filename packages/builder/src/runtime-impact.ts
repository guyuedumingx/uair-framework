import type {
  Storage
} from "@uair/core/runtime";

import type {
  ImpactAnalyzer
} from "./interfaces.js";

import type {
  BusinessSpec,
  BuildPlan,
  ProjectInventory,
  WorkflowRuntimeImpact
} from "./types.js";

function createImpact(
  workflowId: string
): WorkflowRuntimeImpact {
  return {
    workflowId,
    totalExecutions: 0,
    running: 0,
    suspended: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    versions: {},
    deployments: {},
    versionDeployments: {},
    suspensionComponents: {}
  };
}

export class DurableRuntimeImpactAnalyzer
  implements ImpactAnalyzer {
  constructor(
    private readonly storage:
      Pick<
        Storage,
        "listExecutions"
      >
  ) {}

  async analyze(
    spec:
      BusinessSpec,
    _plan:
      BuildPlan,
    inventory:
      ProjectInventory
  ) {
    const executions =
      await this.storage
        .listExecutions();

    const targetIds =
      new Set(
        spec.workflows
          .map(
            workflow =>
              workflow.id
          )
      );

    const runtime =
      new Map<
        string,
        WorkflowRuntimeImpact
      >();

    for (
      const id
      of targetIds
    ) {
      runtime.set(
        id,
        createImpact(id)
      );
    }

    for (
      const execution
      of executions
    ) {
      if (
        !targetIds.has(
          execution.workflow
        )
      ) {
        continue;
      }

      const impact =
        runtime.get(
          execution.workflow
        )!;

      impact.totalExecutions += 1;
      impact[
        execution.status
      ] += 1;

      const version =
        execution
          .workflowVersion ??
        "1";

      impact.versions[
        version
      ] =
        (
          impact.versions[
            version
          ] ??
          0
        ) + 1;

      const deployment =
        execution
          .deploymentId;

      if (deployment) {
        impact.deployments[
          deployment
        ] =
          (
            impact.deployments[
              deployment
            ] ??
            0
          ) + 1;

        const byVersion =
          impact.versionDeployments[
            version
          ] ??
          {};

        byVersion[
          deployment
        ] =
          (
            byVersion[
              deployment
            ] ??
            0
          ) + 1;

        impact.versionDeployments[
          version
        ] =
          byVersion;
      }

      if (
        execution.status ===
        "suspended"
      ) {
        const unresolved =
          execution.history
            .filter(
              entry =>
                entry.kind ===
                "suspension_created"
            )
            .filter(
              created =>
                !execution.history
                  .some(
                    entry =>
                      (
                        entry.kind ===
                          "suspension_resolved" ||
                        entry.kind ===
                          "suspension_cancelled"
                      ) &&
                      entry.suspensionId ===
                        created.suspensionId
                  )
            );

        for (
          const suspension
          of unresolved
        ) {
          impact
            .suspensionComponents[
              suspension.component
            ] =
              (
                impact
                  .suspensionComponents[
                    suspension.component
                  ] ??
                0
              ) + 1;
        }
      }
    }

    const workflowImpacts =
      [
        ...runtime.values()
      ];

    const activeExecutions =
      workflowImpacts
        .reduce(
          (
            total,
            item
          ) =>
            total +
            item.running +
            item.suspended,
          0
        );

    const suspendedExecutions =
      workflowImpacts
        .reduce(
          (
            total,
            item
          ) =>
            total +
            item.suspended,
          0
        );

    const knownIdentity =
      inventory.workflows
        .some(
          existing =>
            targetIds.has(
              existing.id
            )
        );

    const risk =
      suspendedExecutions > 0
        ? "high" as const
        : activeExecutions > 0
          ? "medium" as const
          : knownIdentity
            ? "low" as const
            : "none" as const;

    const versions =
      [
        ...new Set(
          workflowImpacts
            .flatMap(
              item =>
                Object.keys(
                  item.versions
                )
            )
        )
      ];

    const notes:
      string[] = [];

    if (
      suspendedExecutions > 0
    ) {
      notes.push(
        `${suspendedExecutions} suspended execution(s) still depend on the current Workflow identity`
      );
    }

    if (
      activeExecutions > 0
    ) {
      notes.push(
        `${activeExecutions} active execution(s) must not be silently moved onto incompatible code`
      );
    }

    if (
      versions.length
    ) {
      notes.push(
        `Observed runtime Workflow versions: ${versions.join(", ")}`
      );
    }

    for (
      const impact
      of workflowImpacts
    ) {
      const components =
        Object.entries(
          impact
            .suspensionComponents
        );

      if (
        components.length
      ) {
        notes.push(
          `Pending suspension surfaces/components for ${impact.workflowId}: ` +
          components
            .map(
              (
                [
                  component,
                  count
                ]
              ) =>
                `${component}(${count})`
            )
            .join(", ")
        );
      }
    }

    if (
      !notes.length
    ) {
      notes.push(
        knownIdentity
          ? "Workflow identity exists but there are no active durable executions"
          : "No existing Workflow identity or active execution collision detected"
      );
    }

    return {
      activeExecutionRisk:
        risk,
      versionRecommendation:
        knownIdentity ||
        activeExecutions > 0
          ? "Publish a new Workflow version; preserve old deployment compatibility until active executions drain or are explicitly migrated"
          : "Start at Workflow version 1",
      notes,
      runtime: {
        workflows:
          workflowImpacts,
        activeExecutions,
        suspendedExecutions
      }
    };
  }
}
