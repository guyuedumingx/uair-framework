export type AcquisitionDecision =
  | {
      allowed: true;
      reason?: string;
    }
  | {
      allowed: false;
      reason: string;
    };

export type AcquisitionRequest = {
  packageName: string;
  version?: string;
  requestedCapability:
    string;
};

export interface AcquisitionPolicy {
  evaluate(
    request:
      AcquisitionRequest
  ): Promise<
    AcquisitionDecision
  >;
}

export interface PackageInstaller {
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
      source?:
        string;
      issuer?:
        string;
      subject?:
        string;
    };
    evidence?: {
      lifecycleScripts?:
        boolean;
      nativeAddons?:
        boolean;
      network?:
        "none" |
        "registry-only" |
        "any";
      filesystem?:
        "isolated" |
        "host-readonly" |
        "host-readwrite";
      secretNames?:
        string[];
    };
  }>;
}

/**
 * Intentionally separates policy from installation.
 * Runtime Core never calls npm.
 */
export async function acquirePackage(
  request:
    AcquisitionRequest,
  policy:
    AcquisitionPolicy,
  installer:
    PackageInstaller
) {
  const decision =
    await policy.evaluate(
      request
    );

  if (!decision.allowed) {
    throw new Error(
      `Package acquisition denied: ${decision.reason}`
    );
  }

  return installer.install(
    request.packageName,
    request.version
  );
}
