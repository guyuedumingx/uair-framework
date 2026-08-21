import type {
  CapabilityCandidate,
  CapabilityResolver
} from "@uair/package";
import type {
  PackageTrustPolicy
} from "@uair/security";
import type {
  SandboxRunner
} from "./sandbox-installer.js";
import {
  acquireTrustedPackage
} from "./trusted-acquisition.js";
import type {
  LoadedUairPackage
} from "@uair/package";

export type PackageActivator = (
  input: {
    packageName: string;
    version?: string;
    installDir:
      string;
  }
) => Promise<
  LoadedUairPackage
>;

export async function acquireCandidate(
  candidate:
    CapabilityCandidate,
  deps: {
    trust:
      PackageTrustPolicy;
    sandbox:
      SandboxRunner;
    activate:
      PackageActivator;
    resolver:
      CapabilityResolver;
  }
) {
  if (
    candidate.sourceKind !==
      "installable-package"
  ) {
    throw new Error(
      "Candidate is already executable; acquisition is not required"
    );
  }

  const version =
    typeof candidate.metadata
      ?.packageVersion ===
      "string"
      ? candidate.metadata
          .packageVersion
      : undefined;

  const installed =
    await acquireTrustedPackage(
      {
        packageName:
          candidate.sourceName,
        version,
        requestedCapability:
          candidate.id
      },
      deps.trust,
      deps.sandbox
    ) as {
      packageName: string;
      version?: string;
      installDir: string;
    };

  const pkg =
    await deps.activate(
      installed
    );

  deps.resolver.addPackage(
    pkg
  );

  return pkg;
}
