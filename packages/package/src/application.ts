import {
  CapabilitySet
} from "./capability.js";
import type {
  LoadedUairPackage
} from "./package-contract.js";

export type ApplicationPrincipal = {
  id: string;
  roles: string[];
};

export type CapabilityFilter = (
  principal: ApplicationPrincipal,
  capabilities:
    CapabilitySet
) => CapabilitySet;

/**
 * Application is deliberately a composition helper, not a Runtime
 * container. It aggregates exports from already-imported npm packages.
 */
export class UairApplication {
  constructor(
    readonly packages:
      LoadedUairPackage[]
  ) {}

  allCapabilities() {
    const set =
      new CapabilitySet();

    for (const pkg of this.packages) {
      for (
        const capability
        of pkg.manifest
          .capabilities ?? []
      ) {
        set.add(
          capability
        );
      }
    }

    return set;
  }

  capabilitiesFor(
    principal: ApplicationPrincipal,
    filter:
      CapabilityFilter
  ) {
    return filter(
      principal,
      this.allCapabilities()
    );
  }

  workflows() {
    const result:
      Record<
        string,
        unknown
      > = {};

    for (const pkg of this.packages) {
      for (
        const [
          name,
          workflow
        ]
        of Object.entries(
          pkg.manifest
            .workflows ?? {}
        )
      ) {
        result[
          `${pkg.manifest.name}:${name}`
        ] = workflow;
      }
    }

    return result;
  }
}
