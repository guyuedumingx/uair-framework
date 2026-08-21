import {
  verifiedPackageInstaller,
  type PackageTrustPolicy
} from "@uair/security";
import type {
  SandboxRunner
} from "./sandbox-installer.js";
import {
  SandboxedPackageInstaller
} from "./sandbox-installer.js";

export async function acquireTrustedPackage(
  input: {
    packageName: string;
    version?: string;
    requestedCapability:
      string;
  },
  policy:
    PackageTrustPolicy,
  runner:
    SandboxRunner
) {
  const decision =
    await policy.evaluate(
      input
    );

  if (!decision.allowed) {
    throw new Error(
      `Package acquisition denied: ${decision.reason}`
    );
  }

  const installer =
    new SandboxedPackageInstaller(
      runner,
      async () =>
        decision.trust
    );

  const verified =
    verifiedPackageInstaller(
      installer,
      policy,
      input.requestedCapability
    );

  return verified.install(
    input.packageName,
    input.version
  );
}


export class TrustedPackageAcquirer {
  constructor(
    private readonly policy:
      PackageTrustPolicy,
    private readonly runner:
      SandboxRunner
  ) {}

  async acquire(
    input: {
      packageName: string;
      version?: string;
      requestedCapability:
        string;
    }
  ) {
    const installed =
      await acquireTrustedPackage(
        input,
        this.policy,
        this.runner
      );

    return {
      packageName:
        installed.packageName,
      version:
        installed.version,
      installDir:
        installed.installDir,
      integrity:
        installed.integrity,
      provenance:
        installed.provenance,
      evidence:
        installed.evidence
    };
  }
}
