import type {
  LoadedUairPackage
} from "./package-contract.js";
import {
  collectCapabilities
} from "./package-contract.js";
import type {
  Capability
} from "./capability.js";

export type CapabilityMatch = {
  packageName: string;
  packageVersion?: string;
  capability:
    Capability;
  score: number;
};

function tokens(
  text: string
) {
  return text
    .toLowerCase()
    .split(
      /[^a-z0-9_.-]+/
    )
    .filter(Boolean);
}

function scoreCapability(
  query: string,
  capability:
    Capability
) {
  const q =
    new Set(tokens(query));

  const haystack =
    [
      capability.id,
      capability.description ??
        "",
      ...(capability.tags ?? [])
    ].join(" ");

  const hs =
    new Set(
      tokens(haystack)
    );

  let score = 0;

  for (const token of q) {
    if (
      hs.has(token)
    ) {
      score += 3;
    }

    if (
      capability.id
        .toLowerCase()
        .includes(token)
    ) {
      score += 2;
    }
  }

  return score;
}

export class PackageDiscovery {
  constructor(
    private readonly packages:
      LoadedUairPackage[]
  ) {}

  listPackages() {
    return this.packages.map(
      pkg => ({
        source:
          pkg.source,
        name:
          pkg.manifest.name,
        version:
          pkg.manifest.version
      })
    );
  }

  capabilities() {
    return collectCapabilities(
      this.packages
    );
  }

  searchCapabilities(
    query: string,
    limit = 10
  ): CapabilityMatch[] {
    const matches:
      CapabilityMatch[] = [];

    for (const pkg of this.packages) {
      for (
        const capability
        of pkg.manifest
          .capabilities ?? []
      ) {
        const score =
          scoreCapability(
            query,
            capability
          );

        if (score <= 0) {
          continue;
        }

        matches.push({
          packageName:
            pkg.manifest.name,
          packageVersion:
            pkg.manifest.version,
          capability,
          score
        });
      }
    }

    return matches
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(
        0,
        limit
      );
  }
}
