import type {
  DeploymentPlanner
} from "./interfaces.js";

import type {
  DeploymentPlan,
  WorkflowRuntimeImpact
} from "./types.js";

function safeId(
  value: string
) {
  return value
    .replace(
      /[^a-zA-Z0-9._-]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}

function currentWorkflowImpact(
  input:
    Parameters<
      DeploymentPlanner["plan"]
    >[0],
  workflowId: string
): WorkflowRuntimeImpact | undefined {
  return input.impact
    .runtime
    ?.workflows
    .find(
      item =>
        item.workflowId ===
        workflowId
    );
}

export class ConservativeDeploymentPlanner
  implements DeploymentPlanner {
  async plan(
    input:
      Parameters<
        DeploymentPlanner["plan"]
      >[0]
  ): Promise<
    DeploymentPlan
  > {
    const workflowId =
      input.spec
        .workflows[0]
        ?.id ??
      input.buildPlan
        .workflowIds[0];

    if (!workflowId) {
      throw new Error(
        "Deployment Planner requires at least one Workflow"
      );
    }

    const targetVersion =
      input.buildPlan
        .workflowVersions[
          workflowId
        ];

    if (!targetVersion) {
      throw new Error(
        `Missing target Workflow version for ${workflowId}`
      );
    }

    const runtime =
      currentWorkflowImpact(
        input,
        workflowId
      );

    const versions =
      Object.keys(
        runtime?.versions ??
        {}
      );

    const numericPrevious =
      versions
        .filter(
          value =>
            /^\d+$/.test(
              value
            ) &&
            value !==
              targetVersion
        )
        .map(Number)
        .sort(
          (
            a,
            b
          ) =>
            b - a
        )[0];

    const previousVersion =
      numericPrevious !==
        undefined
        ? String(
            numericPrevious
          )
        : versions.find(
            value =>
              value !==
              targetVersion
          );

    const targetDeploymentId =
      `deploy-${safeId(
        input.spec.packageName
      )}-${safeId(
        workflowId
      )}-v${safeId(
        targetVersion
      )}`;

    const previousDeploymentIds =
      previousVersion
        ? Object.keys(
            runtime
              ?.versionDeployments
              ?.[
                previousVersion
              ] ??
            {}
          )
        : [];

    const active =
      runtime
        ? runtime.running +
          runtime.suspended
        : 0;

    const suspended =
      runtime?.suspended ??
      0;

    const steps:
      DeploymentPlan["steps"] =
      [
        {
          phase:
            "deploy",
          action:
            "publish-package",
          workflowId,
          version:
            targetVersion,
          detail:
            `Publish ${input.spec.packageName}@${input.packageVersion}.`
        },
        {
          phase:
            "deploy",
          action:
            "deploy-version",
          workflowId,
          version:
            targetVersion,
          deploymentId:
            targetDeploymentId,
          detail:
            `Deploy ${workflowId}@${targetVersion} as ${targetDeploymentId}.`
        },
        {
          phase:
            "cutover",
          action:
            "route-new-executions",
          workflowId,
          version:
            targetVersion,
          deploymentId:
            targetDeploymentId,
          detail:
            `Route new ${workflowId} executions to version ${targetVersion}.`
        }
      ];

    let retireGate:
      DeploymentPlan["retireGate"];

    if (
      previousVersion
    ) {
      steps.push({
        phase:
          "retain",
        action:
          "keep-old-deployment",
        workflowId,
        version:
          previousVersion,
        deploymentId:
          previousDeploymentIds[0],
        detail:
          active > 0
            ? `Keep version ${previousVersion} available for ${active} active pinned execution(s).`
            : `Old version ${previousVersion} has no active pinned executions.`
      });

      steps.push({
        phase:
          "retain",
        action:
          "watch-drain",
        workflowId,
        version:
          previousVersion,
        deploymentId:
          previousDeploymentIds[0],
        detail:
          `Retire only when active and suspended execution counts reach zero.`
      });

      retireGate = {
        workflowId,
        version:
          previousVersion,
        deploymentId:
          previousDeploymentIds[0],
        requiredActiveExecutions:
          0,
        currentActiveExecutions:
          active,
        currentSuspendedExecutions:
          suspended,
        ready:
          active === 0 &&
          suspended === 0,
        reasons:
          active === 0 &&
          suspended === 0
            ? [
                "No active execution remains pinned to the previous Workflow version."
              ]
            : [
                `${active} active execution(s) remain pinned to the previous Workflow version.`,
                `${suspended} suspended execution(s) must remain resumable before retirement.`
              ]
      };

      steps.push({
        phase:
          "retire",
        action:
          "retire-old-deployment",
        workflowId,
        version:
          previousVersion,
        deploymentId:
          previousDeploymentIds[0],
        detail:
          retireGate.ready
            ? `Retire old deployment now.`
            : `Blocked until retire gate becomes ready.`
      });
    }

    const migrationAllows =
      input.migrationPlan
        ? input.migrationPlan
            .releaseAllowed
        : true;

    const checks = [
      {
        id:
          "migration-allows-release",
        passed:
          migrationAllows,
        message:
          migrationAllows
            ? "Migration plan allows release."
            : "Migration plan blocks release."
      },
      {
        id:
          "target-version-present",
        passed:
          Boolean(
            targetVersion
          ),
        message:
          `Target Workflow version is ${targetVersion}.`
      },
      {
        id:
          "retirement-separated-from-cutover",
        passed:
          true,
        message:
          "Old deployment retirement is controlled by an explicit drain gate, not by deployment success."
      }
    ];

    const artifact = {
      path:
        "deployment/release-plan.json",
      content:
        JSON.stringify(
          {
            package:
              input.spec.packageName,
            packageVersion:
              input.packageVersion,
            workflow:
              workflowId,
            targetVersion,
            targetDeploymentId,
            previousVersion:
              previousVersion ??
              null,
            previousDeploymentIds,
            steps,
            retireGate:
              retireGate ??
              null
          },
          null,
          2
        ) +
        "\n"
    };

    return {
      releaseAllowed:
        checks.every(
          check =>
            check.passed
        ),
      target: {
        packageName:
          input.spec.packageName,
        packageVersion:
          input.packageVersion,
        workflowId,
        workflowVersion:
          targetVersion,
        deploymentId:
          targetDeploymentId
      },
      previous:
        previousVersion
          ? {
              workflowVersion:
                previousVersion,
              deploymentIds:
                previousDeploymentIds
            }
          : undefined,
      steps,
      retireGate,
      artifact,
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
}

export function evaluateRetireGate(
  plan:
    DeploymentPlan,
  current:
    WorkflowRuntimeImpact
) {
  if (!plan.retireGate) {
    return {
      ready:
        true,
      reasons: [
        "No previous deployment requires retirement."
      ]
    };
  }

  const active =
    current.running +
    current.suspended;

  const suspended =
    current.suspended;

  return {
    ready:
      active === 0 &&
      suspended === 0,
    reasons:
      active === 0 &&
      suspended === 0
        ? [
            "All pinned executions have drained."
          ]
        : [
            `${active} active execution(s) remain.`,
            `${suspended} suspended execution(s) remain.`
          ]
  };
}
