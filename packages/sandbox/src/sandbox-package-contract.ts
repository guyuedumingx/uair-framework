import {
  readFile
} from "node:fs/promises";
import {
  join
} from "node:path";
import type {
  SandboxedCapabilityDescriptor
} from "./sandbox-capability.js";

export type SandboxedPackageManifest = {
  name: string;
  version?: string;
  capabilities:
    SandboxedCapabilityDescriptor[];
};

export async function loadSandboxedPackageManifest(
  installDir: string,
  packageName: string
): Promise<
  SandboxedPackageManifest
> {
  const path =
    join(
      installDir,
      "node_modules",
      packageName,
      "uair.json"
    );

  const raw =
    await readFile(
      path,
      "utf8"
    );

  const manifest =
    JSON.parse(raw) as
      SandboxedPackageManifest;

  if (
    typeof manifest.name !==
      "string" ||
    !Array.isArray(
      manifest.capabilities
    )
  ) {
    throw new Error(
      `Invalid sandboxed UAIR package manifest for ${packageName}`
    );
  }

  for (
    const descriptor
    of manifest.capabilities
  ) {
    if (
      typeof descriptor.id !==
        "string" ||
      typeof descriptor.entrypoint !==
        "string"
    ) {
      throw new Error(
        `Invalid capability descriptor in ${packageName}`
      );
    }

    if (
      descriptor.entrypoint
        .startsWith("/") ||
      descriptor.entrypoint
        .includes("..")
    ) {
      throw new Error(
        `Unsafe capability entrypoint "${descriptor.entrypoint}"`
      );
    }
  }

  return manifest;
}
