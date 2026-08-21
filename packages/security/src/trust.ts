export type PackageTrustRecord = {
  packageName: string;
  allowedVersions?: string[];
  integrity?: string;
  provenanceRequired?: boolean;
  allowNativeAddons?: boolean;
  allowLifecycleScripts?: boolean;
  network?: "none" | "registry-only" | "any";
  filesystem?: "isolated" | "host-readonly" | "host-readwrite";
  allowedSecrets?: string[];
};

export interface PackageTrustPolicy {
  evaluate(
    input: {
      packageName: string;
      version?: string;
      requestedCapability:
        string;
    }
  ): Promise<
    | {
        allowed: true;
        trust:
          PackageTrustRecord;
      }
    | {
        allowed: false;
        reason: string;
      }
  >;
}

export function staticTrustPolicy(
  records:
    PackageTrustRecord[]
): PackageTrustPolicy {
  const byName =
    new Map(
      records.map(
        record => [
          record.packageName,
          record
        ]
      )
    );

  return {
    async evaluate(input) {
      const trust =
        byName.get(
          input.packageName
        );

      if (!trust) {
        return {
          allowed: false,
          reason:
            "package is not on the trusted package allowlist"
        };
      }

      if (
        input.version &&
        trust.allowedVersions &&
        !trust.allowedVersions.includes(
          input.version
        )
      ) {
        return {
          allowed: false,
          reason:
            `version ${input.version} is not allowed`
        };
      }

      return {
        allowed: true,
        trust
      };
    }
  };
}
