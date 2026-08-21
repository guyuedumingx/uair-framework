import {
  component
} from "@uair/core";
import type {
  CapabilityCandidate
} from "@uair/package";
import type {
  PackageTrustPolicy,
  PackageTrustRecord
} from "@uair/security";
import type {
  SandboxRunner
} from "./sandbox-installer.js";
import {
  acquireTrustedPackage
} from "./trusted-acquisition.js";
import {
  loadSandboxedPackageManifest
} from "./sandbox-package-contract.js";
import {
  sandboxedCapability
} from "./sandbox-capability.js";
import {
  CapabilitySet
} from "@uair/package";

export type InstalledSandboxPackage = {
  packageName: string;
  version?: string;
  installDir: string;
};

export function createSandboxPackageAcquirer(
  name: string,
  policy:
    PackageTrustPolicy,
  runner:
    SandboxRunner
) {
  return component<
    CapabilityCandidate,
    InstalledSandboxPackage
  >(
    `package.acquire:${name}`,
    async candidate => {
      if (
        candidate.sourceKind !==
          "installable-package"
      ) {
        throw new Error(
          "Only installable package candidates can be acquired"
        );
      }

      const version =
        typeof candidate.metadata
          ?.packageVersion ===
          "string"
          ? candidate.metadata
              .packageVersion
          : undefined;

      return await acquireTrustedPackage(
        {
          packageName:
            candidate.sourceName,
          version,
          requestedCapability:
            candidate.id
        },
        policy,
        runner
      ) as InstalledSandboxPackage;
    }
  );
}

export async function activateSandboxPackage(
  installed:
    InstalledSandboxPackage,
  trust:
    PackageTrustRecord,
  runner:
    SandboxRunner
) {
  const manifest =
    await loadSandboxedPackageManifest(
      installed.installDir,
      installed.packageName
    );

  const capabilities =
    new CapabilitySet();

  for (
    const descriptor
    of manifest.capabilities
  ) {
    capabilities.add(
      sandboxedCapability({
        packageName:
          installed.packageName,
        installDir:
          installed.installDir,
        descriptor,
        trust,
        runner
      })
    );
  }

  return {
    manifest,
    capabilities
  };
}
