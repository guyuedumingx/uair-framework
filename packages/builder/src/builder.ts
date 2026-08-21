import {
  workflow
} from "@uair/core";

import type {
  BuildPlan,
  BuilderResult,
  BusinessSpec,
  ProjectInventory,
  RequirementRequest
} from "./types.js";

import type {
  ArtifactImplementer,
  ArtifactVerifier,
  CapabilityResolutionPlanner,
  ChangeAnalyzer,
  DeploymentPlanner,
  ImpactAnalyzer,
  MigrationPlanner,
  PreviewBuilder,
  ProjectInspector,
  ReleasePlanner,
  RequirementAnalyst,
  SolutionArchitect
} from "./interfaces.js";

/**
 * Normalize architect capability choices against deterministic ProjectInventory
 * evidence before implementation.
 *
 * Rules:
 * - a capability provided by another package with a public export is reused;
 * - a capability owned by the package currently being replaced is regenerated;
 * - an "existing" claim without deterministic provider/export evidence is not
 *   trusted and falls back to generation;
 * - install/MCP decisions remain available for the optional resolver layer.
 */
function normalizeCapabilityPlan(
  spec:
    BusinessSpec,
  plan:
    BuildPlan,
  inventory:
    ProjectInventory
): BuildPlan {
  const byId =
    new Map(
      plan.capabilities.map(
        item => [
          item.id,
          item
        ]
      )
    );

  const capabilities =
    spec.capabilities.map(
      need => {
        const planned =
          byId.get(
            need.id
          ) ?? {
            id:
              need.id,
            source:
              "generate" as const,
            detail:
              "Architect omitted required capability; generate package-local implementation."
          };

        const provider =
          inventory
            .capabilityProviders
            ?.[need.id];

        const reusableExternal =
          Boolean(
            provider
              ?.packageName &&
            provider
              ?.exportName
          ) &&
          provider!
            .packageName !==
            spec.packageName;

        if (
          reusableExternal
        ) {
          return {
            ...planned,
            source:
              "existing" as const,
            detail:
              `Reuse existing project capability from ${provider!.packageName}.`,
            providerPackage:
              provider!
                .packageName,
            exportName:
              provider!
                .exportName
          };
        }

        if (
          provider
            ?.packageName ===
            spec.packageName
        ) {
          return {
            ...planned,
            source:
              "generate" as const,
            detail:
              "Capability belongs to the target package being replaced; preserve/regenerate it locally.",
            providerPackage:
              undefined,
            providerVersion:
              undefined,
            exportName:
              undefined
          };
        }

        if (
          planned.source ===
            "existing" &&
          !(
            planned
              .providerPackage &&
            planned
              .exportName
          )
        ) {
          return {
            ...planned,
            source:
              "generate" as const,
            detail:
              "Existing capability claim had no deterministic provider/export evidence; generate locally.",
            providerPackage:
              undefined,
            providerVersion:
              undefined,
            exportName:
              undefined
          };
        }

        return planned;
      }
    );

  return {
    ...plan,
    capabilities,
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
        )
  };
}

export type BuilderDependencies = {
  inspector: ProjectInspector;
  analyst: RequirementAnalyst;
  architect: SolutionArchitect;
  capabilities?:
    CapabilityResolutionPlanner;
  implementer: ArtifactImplementer;
  verifier: ArtifactVerifier;
  changes?: ChangeAnalyzer;
  impact: ImpactAnalyzer;
  migration?: MigrationPlanner;
  deployment?: DeploymentPlanner;
  preview: PreviewBuilder;
  release: ReleasePlanner;
};

/**
 * Builder itself is a durable UAIR Workflow.
 *
 * It creates a release proposal only. Publishing/deployment is
 * intentionally outside this Workflow and requires a separate
 * authorized action.
 */
export function createBuilderWorkflow(
  deps: BuilderDependencies
) {
  return workflow<
    RequirementRequest,
    BuilderResult
  >({
    id:
      "uair.builder.build",
    version:
      "1",

    async run(request) {
      const inventory =
        await deps.inspector
          .inspect();

      const spec =
        await deps.analyst
          .analyze(
            request,
            inventory
          );

      const rawArchitecturalPlan =
        await deps.architect
          .plan(
            spec,
            inventory
          );

      const architecturalPlan =
        normalizeCapabilityPlan(
          spec,
          rawArchitecturalPlan,
          inventory
        );

      const capabilityResolution =
        deps.capabilities
          ? await deps.capabilities
              .resolve(
                spec,
                architecturalPlan,
                inventory
              )
          : undefined;

      if (
        capabilityResolution &&
        !capabilityResolution
          .report
          .resolved
      ) {
        throw new Error(
          `Builder capability resolution failed: ${capabilityResolution.report.unresolvedRequired.join(", ")}`
        );
      }

      const plan =
        capabilityResolution
          ?.plan ??
        architecturalPlan;

      const extensionPlan =
        capabilityResolution
          ? {
              required:
                capabilityResolution
                  .report
                  .capabilities
                  .some(
                    item =>
                      item.selected ===
                        "install"
                  ),
              actions:
                capabilityResolution
                  .report
                  .capabilities
                  .filter(
                    item =>
                      item.selected ===
                        "install" &&
                      item.candidate
                  )
                  .map(
                    item => ({
                      capabilityId:
                        item.id,
                      kind:
                        "install-package" as const,
                      packageName:
                        item.candidate!
                          .sourceName,
                      version:
                        item.candidate!
                          .packageVersion
                    })
                  )
            }
          : undefined;

      const artifacts =
        await deps.implementer
          .implement(
            spec,
            plan
          );

      const verification =
        await deps.verifier
          .verify(
            spec,
            plan,
            artifacts
          );

      if (
        !verification.passed
      ) {
        const failed =
          verification.checks
            .filter(
              check =>
                !check.passed
            )
            .map(
              check =>
                `${check.id}: ${check.message}`
            );

        throw new Error(
          `Builder verification failed${failed.length ? `: ${failed.join("; ")}` : ""}`
        );
      }

      const changes =
        deps.changes
          ? await deps.changes
              .analyze(
                spec,
                artifacts
              )
          : undefined;

      if (
        changes &&
        !changes.safety.safe
      ) {
        throw new Error(
          "Builder ChangeSet safety verification failed"
        );
      }

      if (
        changes
          ?.architectureGovernance &&
        !changes
          .architectureGovernance
          .healthy
      ) {
        throw new Error(
          `Builder architecture governance verification failed: ${changes.architectureGovernance.issues.filter(issue => issue.severity === "error").map(issue => `${issue.code}: ${issue.message}`).join("; ")}`
        );
      }

      const impact =
        await deps.impact
          .analyze(
            spec,
            plan,
            inventory
          );

      const migrationPlan =
        deps.migration
          ? await deps.migration
              .plan({
                spec,
                buildPlan:
                  plan,
                changeSet:
                  changes?.changeSet,
                changeSafety:
                  changes?.safety,
                contractCompatibility:
                  changes
                    ?.contractCompatibility,
                impact
              })
          : undefined;

      if (
        changes
          ?.contractCompatibility &&
        !changes
          .contractCompatibility
          .compatible &&
        !migrationPlan
          ?.releaseAllowed
      ) {
        throw new Error(
          "Builder contract compatibility verification failed"
        );
      }

      if (
        migrationPlan &&
        !migrationPlan
          .verification
          .passed
      ) {
        throw new Error(
          "Builder migration verification failed"
        );
      }

      const deploymentPlan =
        deps.deployment
          ? await deps.deployment
              .plan({
                spec,
                buildPlan:
                  plan,
                impact,
                migrationPlan,
                packageVersion:
                  "0.1.0"
              })
          : undefined;

      if (
        deploymentPlan &&
        !deploymentPlan
          .releaseAllowed
      ) {
        throw new Error(
          "Builder deployment plan blocks release"
        );
      }

      const preview =
        await deps.preview
          .build(
            spec,
            plan,
            artifacts
          );

      const proposal =
        await deps.release
          .propose({
            spec,
            plan,
            artifacts,
            preview,
            verification,
            impact,
            changeSet:
              changes?.changeSet,
            changeSafety:
              changes?.safety,
            contractCompatibility:
              changes
                ?.contractCompatibility,
            architectureGovernance:
              changes
                ?.architectureGovernance,
            capabilityResolution:
              capabilityResolution
                ?.report,
            extensionPlan,
            migrationPlan,
            deploymentPlan
          });

      return {
        request,
        inventory,
        spec,
        plan,
        proposal
      };
    }
  });
}
