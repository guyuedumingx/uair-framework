import type {
  CapabilityCandidate,
  CapabilityResolver
} from "@uair/package";

import type {
  CapabilityResolutionPlanner
} from "./interfaces.js";

import type {
  BuildPlan,
  CapabilityResolutionEvidence
} from "./types.js";

function stringMetadata(
  candidate:
    CapabilityCandidate,
  key: string
) {
  const value =
    candidate.metadata?.[key];

  return typeof value ===
    "string"
    ? value
    : undefined;
}

function candidateEvidence(
  candidate:
    CapabilityCandidate
) {
  return {
    id:
      candidate.id,
    sourceKind:
      candidate.sourceKind,
    sourceName:
      candidate.sourceName,
    score:
      candidate.score,
    packageVersion:
      stringMetadata(
        candidate,
        "packageVersion"
      ),
    exportName:
      stringMetadata(
        candidate,
        "exportName"
      )
  };
}

/**
 * Planning only.
 *
 * This class never installs a package and never activates generated code.
 * It converts discovery evidence into an explicit BuildPlan that can later be
 * authorized and executed by the extension/release control plane.
 */
export class ResolverBackedCapabilityPlanner
  implements CapabilityResolutionPlanner {
  constructor(
    private readonly resolver:
      CapabilityResolver
  ) {}

  async resolve(
    spec:
      Parameters<
        CapabilityResolutionPlanner[
          "resolve"
        ]
      >[0],
    plan:
      BuildPlan,
    _inventory:
      Parameters<
        CapabilityResolutionPlanner[
          "resolve"
        ]
      >[2]
  ) {
    const evidence:
      CapabilityResolutionEvidence[] =
      [];

    const required =
      new Map(
        spec.capabilities.map(
          item => [
            item.id,
            item
          ]
        )
      );

    const capabilities =
      await Promise.all(
        plan.capabilities.map(
          async item => {
            const need =
              required.get(
                item.id
              );

            const requested =
              [
                item.id,
                need?.description
              ]
                .filter(Boolean)
                .join(" ");

            if (
              item.source ===
                "existing" &&
              item.providerPackage
            ) {
              evidence.push({
                id:
                  item.id,
                requested,
                selected:
                  "existing",
                reason:
                  `Existing project provider ${item.providerPackage} already satisfies the capability.`
              });

              return item;
            }

            const candidates =
              await this.resolver
                .discover(
                  requested
                );

            const executable =
              candidates.find(
                candidate =>
                  candidate.executable
              );

            if (
              executable &&
              executable.sourceKind ===
                "connected-mcp"
            ) {
              evidence.push({
                id:
                  item.id,
                requested,
                selected:
                  "mcp",
                reason:
                  `Connected MCP capability ${executable.id} is already executable.`,
                candidate:
                  candidateEvidence(
                    executable
                  )
              });

              return {
                ...item,
                source:
                  "mcp" as const,
                detail:
                  `Reuse connected MCP capability ${executable.id}.`,
                providerPackage:
                  executable
                    .sourceName
              };
            }

            if (executable) {
              const providerPackage =
                stringMetadata(
                  executable,
                  "packageName"
                ) ??
                (
                  executable
                    .sourceName !==
                    "loaded"
                    ? executable
                        .sourceName
                    : undefined
                );

              const exportName =
                stringMetadata(
                  executable,
                  "exportName"
                );

              if (
                providerPackage &&
                exportName
              ) {
                evidence.push({
                  id:
                    item.id,
                  requested,
                  selected:
                    "existing",
                  reason:
                    `Loaded package ${providerPackage} exposes a reusable capability.`,
                  candidate:
                    candidateEvidence(
                      executable
                    )
                });

                return {
                  ...item,
                  source:
                    "existing" as const,
                  detail:
                    `Reuse loaded package ${providerPackage}.`,
                  providerPackage,
                  providerVersion:
                    stringMetadata(
                      executable,
                      "packageVersion"
                    ),
                  exportName
                };
              }
            }

            const installable =
              candidates.find(
                candidate =>
                  candidate.sourceKind ===
                    "installable-package" &&
                  Boolean(
                    stringMetadata(
                      candidate,
                      "exportName"
                    )
                  )
              );

            if (installable) {
              const exportName =
                stringMetadata(
                  installable,
                  "exportName"
                )!;

              const providerVersion =
                stringMetadata(
                  installable,
                  "packageVersion"
                );

              evidence.push({
                id:
                  item.id,
                requested,
                selected:
                  "install",
                reason:
                  `Installable package ${installable.sourceName} is preferred over generating duplicate capability code.`,
                candidate:
                  candidateEvidence(
                    installable
                  )
              });

              return {
                ...item,
                source:
                  "install" as const,
                detail:
                  `Install ${installable.sourceName}${providerVersion ? `@${providerVersion}` : ""} and reuse ${exportName}.`,
                providerPackage:
                  installable
                    .sourceName,
                providerVersion,
                exportName
              };
            }

            evidence.push({
              id:
                item.id,
              requested,
              selected:
                "generate",
              reason:
                candidates.length
                  ? "Discovered candidates were not safely integrable as an importable capability; generate a package-local implementation."
                  : "No reusable or installable capability was discovered."
            });

            return {
              ...item,
              source:
                "generate" as const,
              detail:
                "Generate package-local capability implementation.",
              providerPackage:
                undefined,
              providerVersion:
                undefined,
              exportName:
                undefined
            };
          }
        )
      );

    const unresolvedRequired =
      spec.capabilities
        .filter(
          item =>
            item.required &&
            !capabilities.some(
              capability =>
                capability.id ===
                  item.id
            )
        )
        .map(
          item =>
            item.id
        );

    return {
      plan: {
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
      },
      report: {
        resolved:
          unresolvedRequired.length ===
            0,
        capabilities:
          evidence,
        unresolvedRequired
      }
    };
  }
}
