import type {
  PackageTrustPolicy
} from "./trust.js";

export interface PackageInstallerLike {
  install(
    packageName: string,
    version?: string
  ): Promise<{
    packageName: string;
    version?: string;
    installDir?: string;
    integrity?: string;
    resolved?: string;
    provenance?: {
      verified: boolean;
      source?: string;
      issuer?: string;
      subject?: string;
    };
    evidence?: {
      lifecycleScripts?: boolean;
      nativeAddons?: boolean;
      network?: "none" | "registry-only" | "any";
      filesystem?: "isolated" | "host-readonly" | "host-readwrite";
      secretNames?: string[];
    };
  }>;
}

export class PackageProvenanceError
  extends Error {
  constructor(
    message: string
  ) {
    super(message);
    this.name =
      "PackageProvenanceError";
  }
}

export function verifiedPackageInstaller(
  installer:
    PackageInstallerLike,
  trustPolicy:
    PackageTrustPolicy,
  requestedCapability:
    string
): PackageInstallerLike {
  return {
    async install(
      packageName,
      version
    ) {
      const decision =
        await trustPolicy
          .evaluate({
            packageName,
            version,
            requestedCapability
          });

      if (
        !decision.allowed
      ) {
        throw new PackageProvenanceError(
          `Package trust denied: ${decision.reason}`
        );
      }

      const installed =
        await installer.install(
          packageName,
          version
        );

      const trust =
        decision.trust;

      if (
        trust.integrity &&
        installed.integrity !==
          trust.integrity
      ) {
        throw new PackageProvenanceError(
          `Integrity mismatch for ${packageName}.`
        );
      }

      if (
        trust.provenanceRequired &&
        installed.provenance
          ?.verified !==
          true
      ) {
        throw new PackageProvenanceError(
          `Verified provenance is required for ${packageName}.`
        );
      }

      const evidence =
        installed.evidence;

      if (
        evidence?.lifecycleScripts ===
          true &&
        trust.allowLifecycleScripts !==
          true
      ) {
        throw new PackageProvenanceError(
          `Lifecycle scripts are not allowed for ${packageName}.`
        );
      }

      if (
        evidence?.nativeAddons ===
          true &&
        trust.allowNativeAddons !==
          true
      ) {
        throw new PackageProvenanceError(
          `Native addons are not allowed for ${packageName}.`
        );
      }

      const networkRank = {
        none: 0,
        "registry-only": 1,
        any: 2
      } as const;

      if (
        evidence?.network &&
        networkRank[
          evidence.network
        ] >
        networkRank[
          trust.network ??
          "registry-only"
        ]
      ) {
        throw new PackageProvenanceError(
          `Observed network permission "${evidence.network}" exceeds trust policy for ${packageName}.`
        );
      }

      const filesystemRank = {
        isolated: 0,
        "host-readonly": 1,
        "host-readwrite": 2
      } as const;

      if (
        evidence?.filesystem &&
        filesystemRank[
          evidence.filesystem
        ] >
        filesystemRank[
          trust.filesystem ??
          "isolated"
        ]
      ) {
        throw new PackageProvenanceError(
          `Observed filesystem permission "${evidence.filesystem}" exceeds trust policy for ${packageName}.`
        );
      }

      if (
        evidence
          ?.secretNames
          ?.some(
            name =>
              !(
                trust
                  .allowedSecrets ??
                []
              ).includes(
                name
              )
          )
      ) {
        throw new PackageProvenanceError(
          `Package ${packageName} requested a secret outside the trust allowlist.`
        );
      }

      if (
        installed.packageName !==
          packageName
      ) {
        throw new PackageProvenanceError(
          `Installer returned unexpected package "${installed.packageName}".`
        );
      }

      if (
        version &&
        installed.version &&
        installed.version !==
          version
      ) {
        throw new PackageProvenanceError(
          `Installer returned version ${installed.version}; expected ${version}.`
        );
      }

      return installed;
    }
  };
}
