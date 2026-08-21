import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  join,
  resolve
} from "node:path";

import type {
  Storage
} from "@uair/core/runtime";

import type {
  DeploymentPlan,
  ReleaseProposal,
  WorkflowRuntimeImpact
} from "./types.js";

import {
  DurableRuntimeImpactAnalyzer
} from "./runtime-impact.js";

import {
  evaluateRetireGate
} from "./deployment-planner.js";

export type ReleaseControllerState = {
  proposalFile: string;
  proposal:
    ReleaseProposal;
  released?: {
    approvedAt: number;
    targetDeploymentId: string;
    workflowId: string;
    workflowVersion: string;
  };
  retired?: Array<{
    retiredAt: number;
    workflowId: string;
    workflowVersion: string;
    deploymentId?: string;
  }>;
  releaseAttempts?: Array<{
    attemptedAt: number;
    status:
      | "in-progress"
      | "released"
      | "failed";
    deploymentId?: string;
    error?: string;
    events:
      DeploymentExecutionEvent[];
  }>;
};

export type ReleaseControllerStatus = {
  phase:
    | "proposal"
    | "released"
    | "retired";
  proposal:
    ReleaseProposal;
  releaseReady: boolean;
  released: boolean;
  retireReady?: boolean;
  runtimeImpact?: {
    workflow:
      WorkflowRuntimeImpact;
  };
  state:
    ReleaseControllerState;
};

export interface ExtensionReleaseGate {
  satisfied(): Promise<boolean>;
}

export interface DeploymentAdapter {
  deploy(
    plan:
      DeploymentPlan
  ): Promise<{
    deploymentId: string;
  }>;

  retire(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId?: string;
    }
  ): Promise<void>;
}


export type DeploymentExecutionEvent = {
  phase:
    | "publish"
    | "deploy"
    | "health"
    | "cutover"
    | "rollback";
  status:
    | "started"
    | "passed"
    | "failed";
  at: number;
  detail: string;
};

export type DeploymentHealthResult = {
  healthy: boolean;
  detail?: string;
};

export interface ExecutableDeploymentAdapter
  extends DeploymentAdapter {
  publishPackage?(
    input: {
      packageName: string;
      packageVersion: string;
    }
  ): Promise<void>;

  checkHealth?(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId: string;
    }
  ): Promise<
    DeploymentHealthResult
  >;

  routeNewExecutions?(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId: string;
    }
  ): Promise<void>;

  rollback?(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId: string;
      reason: string;
    }
  ): Promise<void>;
}

/**
 * Default adapter used by the CLI MVP.
 *
 * It deliberately records intent/results but does not mutate cloud
 * infrastructure. Real Kubernetes/Cloudflare/etc. adapters implement
 * the same interface.
 */
export class LocalReceiptDeploymentAdapter
  implements DeploymentAdapter {
  constructor(
    private readonly receiptDir:
      string
  ) {}

  async deploy(
    plan:
      DeploymentPlan
  ) {
    await mkdir(
      this.receiptDir,
      {
        recursive: true
      }
    );

    await writeFile(
      join(
        this.receiptDir,
        "deploy-receipt.json"
      ),
      JSON.stringify(
        {
          deployedAt:
            Date.now(),
          plan
        },
        null,
        2
      ) +
      "\n",
      "utf8"
    );

    return {
      deploymentId:
        plan.target
          .deploymentId
    };
  }

  async publishPackage(
    input: {
      packageName: string;
      packageVersion: string;
    }
  ) {
    await mkdir(
      this.receiptDir,
      {
        recursive: true
      }
    );

    await writeFile(
      join(
        this.receiptDir,
        "publish-receipt.json"
      ),
      JSON.stringify(
        {
          publishedAt:
            Date.now(),
          ...input
        },
        null,
        2
      ) +
      "\n",
      "utf8"
    );
  }

  async checkHealth(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId: string;
    }
  ): Promise<
    DeploymentHealthResult
  > {
    await writeFile(
      join(
        this.receiptDir,
        "health-receipt.json"
      ),
      JSON.stringify(
        {
          checkedAt:
            Date.now(),
          healthy:
            true,
          ...input
        },
        null,
        2
      ) +
      "\n",
      "utf8"
    );

    return {
      healthy:
        true,
      detail:
        "Local receipt adapter health check passed."
    };
  }

  async routeNewExecutions(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId: string;
    }
  ) {
    await writeFile(
      join(
        this.receiptDir,
        "cutover-receipt.json"
      ),
      JSON.stringify(
        {
          routedAt:
            Date.now(),
          ...input
        },
        null,
        2
      ) +
      "\n",
      "utf8"
    );
  }

  async rollback(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId: string;
      reason: string;
    }
  ) {
    await writeFile(
      join(
        this.receiptDir,
        "rollback-receipt.json"
      ),
      JSON.stringify(
        {
          rolledBackAt:
            Date.now(),
          ...input
        },
        null,
        2
      ) +
      "\n",
      "utf8"
    );
  }

  async retire(
    input: {
      workflowId: string;
      workflowVersion: string;
      deploymentId?: string;
    }
  ) {
    await mkdir(
      this.receiptDir,
      {
        recursive: true
      }
    );

    await writeFile(
      join(
        this.receiptDir,
        `retire-${input.workflowId.replace(/[^a-zA-Z0-9._-]+/g, "-")}-v${input.workflowVersion}.json`
      ),
      JSON.stringify(
        {
          retiredAt:
            Date.now(),
          ...input
        },
        null,
        2
      ) +
      "\n",
      "utf8"
    );
  }
}

export class ReleaseController {
  readonly stateFile:
    string;

  constructor(
    private readonly options: {
      stateDir:
        string;
      storage:
        Pick<
          Storage,
          "listExecutions"
        >;
      adapter:
        DeploymentAdapter;
      extensions?:
        ExtensionReleaseGate;
    }
  ) {
    this.stateFile =
      resolve(
        options.stateDir,
        "release-state.json"
      );
  }

  async saveProposal(
    proposal:
      ReleaseProposal,
    proposalFile:
      string
  ) {
    const state:
      ReleaseControllerState = {
        proposalFile:
          resolve(
            proposalFile
          ),
        proposal
      };

    await this
      .writeState(
        state
      );

    return state;
  }

  async loadState() {
    const raw =
      await readFile(
        this.stateFile,
        "utf8"
      );

    return JSON.parse(
      raw
    ) as
      ReleaseControllerState;
  }

  async review() {
    const state =
      await this.loadState();

    const proposal =
      state.proposal;

    return {
      package:
        `${proposal.packageName}@${proposal.version}`,
      verification:
        proposal.verification
          .passed,
      changeSafe:
        proposal.changeSafety
          ?.safe ??
        true,
      contractCompatible:
        proposal
          .contractCompatibility
          ?.compatible ??
        true,
      migration:
        proposal.migrationPlan
          ?.selected ??
        "none",
      deploymentReady:
        proposal.deploymentPlan
          ?.releaseAllowed ??
        false,
      extensionsRequired:
        proposal.extensionPlan
          ?.required ??
        false,
      extensionsReady:
        proposal.extensionPlan
          ?.required
          ? await this.options
              .extensions
              ?.satisfied() ??
            false
          : true,
      runtimeRisk:
        proposal.impact
          .activeExecutionRisk,
      target:
        proposal.deploymentPlan
          ?.target,
      retireGate:
        proposal.deploymentPlan
          ?.retireGate
    };
  }

  async release(
    approved:
      boolean
  ) {
    if (!approved) {
      throw new Error(
        "Release requires explicit approval."
      );
    }

    const state =
      await this.loadState();

    const plan =
      state.proposal
        .deploymentPlan;

    if (
      !plan ||
      !plan.releaseAllowed ||
      !plan.verification
        .passed
    ) {
      throw new Error(
        "Release blocked: DeploymentPlan is not verified/releaseable."
      );
    }

    if (
      state.proposal
        .changeSafety &&
      !state.proposal
        .changeSafety
        .safe
    ) {
      throw new Error(
        "Release blocked: ChangeSet safety failed."
      );
    }

    if (
      state.proposal
        .migrationPlan &&
      !state.proposal
        .migrationPlan
        .releaseAllowed
    ) {
      throw new Error(
        "Release blocked: MigrationPlan does not allow release."
      );
    }

    /**
     * Repeated operator approval after a completed release is idempotent.
     */
    if (
      state.released &&
      state.released
        .workflowId ===
        plan.target
          .workflowId &&
      state.released
        .workflowVersion ===
        plan.target
          .workflowVersion
    ) {
      return state.released;
    }

    if (
      state.proposal
        .extensionPlan
        ?.required
    ) {
      const ready =
        await this.options
          .extensions
          ?.satisfied() ??
        false;

      if (!ready) {
        throw new Error(
          "Release blocked: required capability extensions have not been explicitly acquired/approved."
        );
      }
    }

    const adapter =
      this.options
        .adapter as
        ExecutableDeploymentAdapter;

    /**
     * A process may die between external deployment phases.
     *
     * Persist progress after every completed phase and resume the last
     * in-progress attempt on restart. If the process dies after an external
     * call succeeds but before its checkpoint is written, the adapter may be
     * called again. Therefore deployment adapters MUST make package/version,
     * deploymentId and cutover operations idempotent.
     */
    let attempt =
      state.releaseAttempts
        ?.at(-1);

    if (
      !attempt ||
      attempt.status !==
        "in-progress"
    ) {
      attempt = {
        attemptedAt:
          Date.now(),
        status:
          "in-progress",
        events: []
      };

      state.releaseAttempts = [
        ...(
          state.releaseAttempts ??
          []
        ),
        attempt
      ];

      await this
        .writeState(
          state
        );
    }

    const events =
      attempt.events;

    const hasPassed =
      (
        phase:
          DeploymentExecutionEvent["phase"]
      ) =>
        events.some(
          event =>
            event.phase ===
              phase &&
            event.status ===
              "passed"
        );

    const record =
      async (
        phase:
          DeploymentExecutionEvent["phase"],
        status:
          DeploymentExecutionEvent["status"],
        detail:
          string
      ) => {
        events.push({
          phase,
          status,
          at:
            Date.now(),
          detail
        });

        await this
          .writeState(
            state
          );
      };

    let deploymentId =
      attempt.deploymentId;

    try {
      if (
        adapter.publishPackage &&
        !hasPassed(
          "publish"
        )
      ) {
        await record(
          "publish",
          "started",
          `Publishing ${plan.target.packageName}@${plan.target.packageVersion}.`
        );

        await adapter
          .publishPackage({
            packageName:
              plan.target
                .packageName,
            packageVersion:
              plan.target
                .packageVersion
          });

        await record(
          "publish",
          "passed",
          "Package publication completed."
        );
      }

      if (
        !hasPassed(
          "deploy"
        )
      ) {
        await record(
          "deploy",
          "started",
          `Deploying ${plan.target.workflowId}@${plan.target.workflowVersion}.`
        );

        const deployed =
          await adapter
            .deploy(
              plan
            );

        deploymentId =
          deployed
            .deploymentId;

        attempt.deploymentId =
          deploymentId;

        await record(
          "deploy",
          "passed",
          `Deployment ${deploymentId} created.`
        );
      }

      deploymentId =
        deploymentId ??
        plan.target
          .deploymentId;

      if (
        adapter.checkHealth &&
        !hasPassed(
          "health"
        )
      ) {
        await record(
          "health",
          "started",
          `Checking deployment ${deploymentId}.`
        );

        const health =
          await adapter
            .checkHealth({
              workflowId:
                plan.target
                  .workflowId,
              workflowVersion:
                plan.target
                  .workflowVersion,
              deploymentId
            });

        if (
          !health.healthy
        ) {
          throw new Error(
            health.detail ??
            `Deployment ${deploymentId} failed health verification.`
          );
        }

        await record(
          "health",
          "passed",
          health.detail ??
          "Deployment health verification passed."
        );
      }

      if (
        adapter
          .routeNewExecutions &&
        !hasPassed(
          "cutover"
        )
      ) {
        await record(
          "cutover",
          "started",
          `Routing new executions to ${deploymentId}.`
        );

        await adapter
          .routeNewExecutions({
            workflowId:
              plan.target
                .workflowId,
            workflowVersion:
              plan.target
                .workflowVersion,
            deploymentId
          });

        await record(
          "cutover",
          "passed",
          `New executions now route to ${deploymentId}.`
        );
      }

      state.released = {
        approvedAt:
          Date.now(),
        targetDeploymentId:
          deploymentId,
        workflowId:
          plan.target
            .workflowId,
        workflowVersion:
          plan.target
            .workflowVersion
      };

      attempt.status =
        "released";

      attempt.deploymentId =
        deploymentId;

      await this
        .writeState(
          state
        );

      return state.released;
    } catch (
      error
    ) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      if (
        deploymentId &&
        adapter.rollback &&
        !hasPassed(
          "rollback"
        )
      ) {
        await record(
          "rollback",
          "started",
          `Rolling back ${deploymentId}: ${message}`
        );

        try {
          await adapter
            .rollback({
              workflowId:
                plan.target
                  .workflowId,
              workflowVersion:
                plan.target
                  .workflowVersion,
              deploymentId,
              reason:
                message
            });

          await record(
            "rollback",
            "passed",
            `Rollback ${deploymentId} completed.`
          );
        } catch (
          rollbackError
        ) {
          await record(
            "rollback",
            "failed",
            rollbackError instanceof Error
              ? rollbackError.message
              : String(
                  rollbackError
                )
          );
        }
      }

      attempt.status =
        "failed";

      attempt.deploymentId =
        deploymentId;

      attempt.error =
        message;

      await this
        .writeState(
          state
        );

      throw error;
    }
  }

  async status():
    Promise<
      ReleaseControllerStatus
    > {
    const state =
      await this.loadState();

    const proposal =
      state.proposal;

    const plan =
      proposal
        .deploymentPlan;

    let runtimeWorkflow:
      WorkflowRuntimeImpact |
      undefined;

    let retireReady:
      boolean |
      undefined;

    if (
      plan?.previous
    ) {
      const analyzer =
        new DurableRuntimeImpactAnalyzer(
          this.options
            .storage
        );

      const impact =
        await analyzer.analyze(
          {
            applicationId:
              "release.status",
            name:
              "release.status",
            packageName:
              proposal
                .packageName,
            actors: [],
            rules: [],
            capabilities: [],
            surfaces: [],
            workflows: [
              {
                id:
                  plan.target
                    .workflowId,
                description:
                  "release status",
                actors: [],
                rules: [],
                effects: []
              }
            ]
          },
          {
            packageName:
              proposal
                .packageName,
            workflowIds: [
              plan.target
                .workflowId
            ],
            workflowVersions: {
              [
                plan.target
                  .workflowId
              ]:
                plan.target
                  .workflowVersion
            },
            componentIds: [],
            surfaceKinds: [],
            capabilities: [],
            files: [],
            tests: []
          },
          {
            packages: [],
            capabilities: [],
            workflows: [],
            surfaces: []
          }
        );

      runtimeWorkflow =
        impact.runtime
          ?.workflows
          .find(
            item =>
              item.workflowId ===
              plan.target
                .workflowId
          );

      if (runtimeWorkflow) {
        /**
         * Only executions pinned to the previous version may block
         * retirement. New v3 executions must not keep v2 alive.
         */
        const previousVersion =
          plan.previous
            .workflowVersion;

        const executions =
          await this.options
            .storage
            .listExecutions();

        const old =
          executions
            .filter(
              execution =>
                execution.workflow ===
                  plan.target
                    .workflowId &&
                (
                  execution.workflowVersion ??
                  "1"
                ) ===
                  previousVersion
            );

        const running =
          old.filter(
            execution =>
              execution.status ===
              "running"
          ).length;

        const suspended =
          old.filter(
            execution =>
              execution.status ===
              "suspended"
          ).length;

        const scoped:
          WorkflowRuntimeImpact = {
            workflowId:
              plan.target
                .workflowId,
            totalExecutions:
              old.length,
            running,
            suspended,
            completed:
              old.filter(
                execution =>
                  execution.status ===
                  "completed"
              ).length,
            failed:
              old.filter(
                execution =>
                  execution.status ===
                  "failed"
              ).length,
            cancelled:
              old.filter(
                execution =>
                  execution.status ===
                  "cancelled"
              ).length,
            versions: {
              [
                previousVersion
              ]:
                old.length
            },
            deployments:
              {},
            versionDeployments:
              {},
            suspensionComponents:
              {}
          };

        retireReady =
          evaluateRetireGate(
            plan,
            scoped
          ).ready;

        runtimeWorkflow =
          scoped;
      }
    }

    const retired =
      Boolean(
        state.retired
          ?.some(
            item =>
              item.workflowId ===
                plan?.target
                  .workflowId &&
              item.workflowVersion ===
                plan?.previous
                  ?.workflowVersion
          )
      );

    return {
      phase:
        retired
          ? "retired"
          : state.released
            ? "released"
            : "proposal",
      proposal,
      releaseReady:
        Boolean(
          plan
            ?.releaseAllowed
        ),
      released:
        Boolean(
          state.released
        ),
      retireReady,
      runtimeImpact:
        runtimeWorkflow
          ? {
              workflow:
                runtimeWorkflow
            }
          : undefined,
      state
    };
  }

  async retire(
    approved:
      boolean
  ) {
    if (!approved) {
      throw new Error(
        "Retirement requires explicit approval."
      );
    }

    const state =
      await this.loadState();

    if (!state.released) {
      throw new Error(
        "Cannot retire old deployment before the new release is applied."
      );
    }

    const plan =
      state.proposal
        .deploymentPlan;

    if (
      !plan?.previous ||
      !plan.retireGate
    ) {
      throw new Error(
        "No old deployment requires retirement."
      );
    }

    const status =
      await this.status();

    if (
      !status.retireReady
    ) {
      throw new Error(
        "Retire gate is not ready: pinned executions are still active or suspended."
      );
    }

    const retirement = {
      retiredAt:
        Date.now(),
      workflowId:
        plan.target
          .workflowId,
      workflowVersion:
        plan.previous
          .workflowVersion,
      deploymentId:
        plan.previous
          .deploymentIds[0]
    };

    await this.options
      .adapter
      .retire({
        workflowId:
          retirement
            .workflowId,
        workflowVersion:
          retirement
            .workflowVersion,
        deploymentId:
          retirement
            .deploymentId
      });

    state.retired = [
      ...(
        state.retired ??
        []
      ),
      retirement
    ];

    await this
      .writeState(
        state
      );

    return retirement;
  }

  private async writeState(
    state:
      ReleaseControllerState
  ) {
    await mkdir(
      dirname(
        this.stateFile
      ),
      {
        recursive: true
      }
    );

    await writeFile(
      this.stateFile,
      JSON.stringify(
        state,
        null,
        2
      ) +
      "\n",
      "utf8"
    );
  }
}
