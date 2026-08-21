import type {
  InstallablePackageRecord
} from "./capability-resolver.js";

import type {
  UairPackageManifest
} from "./package-contract.js";

export function catalogRecordFromManifest(
  manifest:
    UairPackageManifest
): InstallablePackageRecord {
  return {
    packageName:
      manifest.name,
    version:
      manifest.version,
    description:
      typeof manifest.metadata
        ?.description ===
        "string"
        ? manifest.metadata
            .description
        : undefined,
    capabilities:
      (
        manifest.capabilities ??
        []
      ).map(
        capability => ({
          id:
            capability.id,
          description:
            capability.description,
          tags:
            capability.tags,
          metadata: {
            ...(
              capability.metadata ??
              {}
            ),
            kind:
              capability.kind
          }
        })
      )
  };
}
