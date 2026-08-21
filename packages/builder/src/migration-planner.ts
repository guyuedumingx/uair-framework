import type {
  MigrationPlanner
} from "./interfaces.js";

import type {
  MigrationOption,
  MigrationPlan
} from "./types.js";

function numericMax(
  values: string[]
) {
  return values
    .filter(
      value =>
        /^\d+$/.test(
          value
        )
    )
    .map(Number)
    .sort(
      (
        a,
        b
      ) =>
        b - a
    )[0];
}

export class ConservativeMigrationPlanner
  implements MigrationPlanner {
  async plan(
    input:
      Parameters<
        MigrationPlanner["plan"]
      >[0]
  ): Promise<
    MigrationPlan
  > {
    const compatibility =
      input
        .contractCompatibility;

    const incompatible =
      compatibility
        ? !compatibility.compatible
        : false;

    const active =
      input.impact
        .runtime
        ?.activeExecutions ??
      0;

    const suspended =
      input.impact
        .runtime
        ?.suspendedExecutions ??
      0;

    const workflow =
      input.spec
        .workflows[0];

    const workflowId =
      workflow?.id;

    const targetVersion =
      workflowId
        ? input.buildPlan
            .workflowVersions[
              workflowId
            ]
        : undefined;

    const observedVersions =
      input.impact
        .runtime
        ?.workflows
        .flatMap(
          item =>
            Object.keys(
              item.versions
            )
        ) ??
      [];

    const currentVersion =
      numericMax(
        observedVersions
      );

    const versionAdvanced =
      targetVersion &&
      currentVersion !==
        undefined &&
      /^\d+$/.test(
        targetVersion
      ) &&
      Number(
        targetVersion
      ) >
      currentVersion;

    const options:
      MigrationOption[] = [];

    options.push({
      strategy:
        "version-isolation",
      safe:
        Boolean(
          versionAdvanced
        ),
      recommended:
        Boolean(
          versionAdvanced &&
          (
            active > 0 ||
            incompatible
          )
        ),
      reason:
        versionAdvanced
          ? "Keep old Workflow versions/deployments routable for existing executions while new executions start on the new version."
          : "Requires a new Workflow version before old and new behavior can be isolated.",
      requirements: [
        "Old Workflow version remains registered",
        "Old deployment remains recoverable while active executions exist",
        "New executions route to the proposed Workflow version",
        "No durable History mutation"
      ]
    });

    options.push({
      strategy:
        "compatibility-adapter",
      safe:
        false,
      recommended:
        false,
      reason:
        incompatible
          ? "A compatibility adapter may be possible, but Builder cannot invent missing business values safely without an explicit mapping/default policy."
          : "No compatibility adapter is required.",
      requirements: [
        "Explicit field mapping/default policy",
        "Adapter tests against historical payload samples"
      ]
    });

    options.push({
      strategy:
        "workflow-upgrade",
      safe:
        !incompatible &&
        suspended === 0 &&
        Boolean(
          versionAdvanced
        ),
      recommended:
        false,
      reason:
        suspended > 0
          ? "Explicit Workflow upgrade is not selected while unresolved Suspensions exist."
          : incompatible
            ? "Contract incompatibility must be resolved before upgrading persisted executions."
            : "Can be used when a tested WorkflowUpgrade migration exists and no unresolved Suspension blocks safe conversion.",
      requirements: [
        "VersionedWorkflowRegistry.registerUpgrade()",
        "Pure, deterministic execution migration",
        "Migration verification against persisted execution fixtures"
      ]
    });

    if (
      !incompatible &&
      active === 0
    ) {
      return {
        required:
          false,
        releaseAllowed:
          true,
        selected:
          "none",
        options,
        actions: [],
        artifacts: [],
        verification: {
          passed:
            true,
          checks: [
            {
              id:
                "no-migration-required",
              passed:
                true,
              message:
                "No incompatible contract and no active execution requires a migration strategy."
            }
          ]
        }
      };
    }

    if (
      versionAdvanced
    ) {
      const actions:
        MigrationPlan["actions"] =
        [];

      if (
        workflowId &&
        currentVersion !==
          undefined
      ) {
        actions.push({
          type:
            "keep-workflow-version",
          workflowId,
          fromVersion:
            String(
              currentVersion
            ),
          toVersion:
            targetVersion,
          detail:
            `Keep ${workflowId}@${currentVersion} registered for pinned executions.`
        });

        actions.push({
          type:
            "route-new-executions",
          workflowId,
          fromVersion:
            String(
              currentVersion
            ),
          toVersion:
            targetVersion,
          detail:
            `Start new executions on ${workflowId}@${targetVersion}.`
        });
      }

      if (
        active > 0
      ) {
        actions.push({
          type:
            "keep-deployment",
          workflowId,
          fromVersion:
            currentVersion !==
              undefined
              ? String(
                  currentVersion
                )
              : undefined,
          toVersion:
            targetVersion,
          detail:
            `Keep previous deployment available until ${active} active execution(s) drain or are explicitly migrated.`
        });

        actions.push({
          type:
            "drain-executions",
          workflowId,
          fromVersion:
            currentVersion !==
              undefined
              ? String(
                  currentVersion
                )
              : undefined,
          detail:
            `${suspended} suspended execution(s) remain pinned; do not rewrite their durable History.`
        });
      }

      const artifact =
        {
          path:
            "migration/version-isolation.json",
          content:
            JSON.stringify(
              {
                strategy:
                  "version-isolation",
                workflow:
                  workflowId,
                currentVersion:
                  currentVersion !==
                    undefined
                    ? String(
                        currentVersion
                      )
                    : null,
                targetVersion,
                activeExecutions:
                  active,
                suspendedExecutions:
                  suspended,
                preserveOldDeployment:
                  active > 0,
                routeNewExecutionsTo:
                  targetVersion
              },
              null,
              2
            ) +
            "\n"
        };

      const checks = [
        {
          id:
            "target-version-advanced",
          passed:
            true,
          message:
            `${workflowId ?? "Workflow"} advances to a new durable version.`
        },
        {
          id:
            "history-not-mutated",
          passed:
            true,
          message:
            "Selected strategy does not mutate persisted History or Suspension payloads."
        },
        {
          id:
            "old-version-preserved",
          passed:
            active === 0 ||
            actions.some(
              item =>
                item.type ===
                "keep-workflow-version"
            ),
          message:
            "Old Workflow version is explicitly retained while active executions exist."
        }
      ];

      return {
        required:
          incompatible ||
          active > 0,
        releaseAllowed:
          checks.every(
            check =>
              check.passed
          ),
        selected:
          "version-isolation",
        options:
          options.map(
            option => ({
              ...option,
              recommended:
                option.strategy ===
                "version-isolation"
            })
          ),
        actions,
        artifacts: [
          artifact
        ],
        verification: {
          passed:
            checks.every(
              check =>
                check.passed
            ),
          checks
        }
      };
    }

    return {
      required:
        incompatible ||
        active > 0,
      releaseAllowed:
        false,
      selected:
        "none",
      options,
      actions: [],
      artifacts: [],
      verification: {
        passed:
          false,
        checks: [
          {
            id:
              "no-safe-automatic-migration",
            passed:
              false,
            message:
              "Builder found no safe automatic migration strategy. Advance Workflow version or provide an explicit compatibility mapping."
          }
        ]
      }
    };
  }
}
