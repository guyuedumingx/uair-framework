import {
  CapabilitySet
} from "./capability.js";
import type {
  Capability
} from "./capability.js";
import type {
  WorkflowDefinition,
  Component
} from "@uair/core";

export type UairPackageManifest = {
  name: string;
  version?: string;

  workflows?:
    Record<
      string,
      WorkflowDefinition<any, any>
    >;

  components?:
    Record<
      string,
      Component<any, any>
    >;

  capabilities?:
    Capability[];

  ui?: Record<
    string,
    {
      version?: string;
      description?: string;
      metadata?: Record<
        string,
        unknown
      >;
    }
  >;

  metadata?: Record<
    string,
    unknown
  >;
};

export type LoadedUairPackage = {
  source: string;
  manifest:
    UairPackageManifest;
};


export type PackageManifestValidation = {
  valid: boolean;
  issues: string[];
};

export function validateUairPackageManifest(
  manifest:
    UairPackageManifest
): PackageManifestValidation {
  const issues:
    string[] = [];

  if (
    typeof manifest.name !==
      "string" ||
    manifest.name.trim()
      .length ===
      0
  ) {
    issues.push(
      "manifest.name must be a non-empty package name"
    );
  }

  if (
    manifest.version !==
      undefined &&
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
      .test(
        manifest.version
      )
  ) {
    issues.push(
      `manifest.version is not valid SemVer: ${manifest.version}`
    );
  }

  const durable =
    new Set<
      string
    >();

  const remember =
    (
      kind: string,
      id: string
    ) => {
      const key =
        `${kind}:${id}`;

      if (
        durable.has(
          key
        )
      ) {
        issues.push(
          `duplicate ${kind} id "${id}"`
        );

        return;
      }

      durable.add(
        key
      );
    };

  for (
    const [
      name,
      workflow
    ]
    of Object.entries(
      manifest.workflows ??
      {}
    )
  ) {
    if (
      !workflow ||
      typeof workflow.id !==
        "string" ||
      workflow.id.trim()
        .length ===
        0
    ) {
      issues.push(
        `workflow export "${name}" is missing stable id`
      );

      continue;
    }

    remember(
      "workflow",
      workflow.id
    );
  }

  for (
    const [
      name,
      component
    ]
    of Object.entries(
      manifest.components ??
      {}
    )
  ) {
    if (
      !component ||
      typeof component.id !==
        "string" ||
      component.id.trim()
        .length ===
        0
    ) {
      issues.push(
        `component export "${name}" is missing stable id`
      );

      continue;
    }

    remember(
      "component",
      component.id
    );
  }

  for (
    const capability
    of manifest.capabilities ??
    []
  ) {
    if (
      !capability.id ||
      capability.id.trim()
        .length ===
        0
    ) {
      issues.push(
        "capability is missing id"
      );

      continue;
    }

    remember(
      "capability",
      capability.id
    );
  }

  for (
    const [
      kind,
      ui
    ]
    of Object.entries(
      manifest.ui ??
      {}
    )
  ) {
    if (
      kind.trim()
        .length ===
        0
    ) {
      issues.push(
        "UI surface kind must be non-empty"
      );
    }

    if (
      ui.version !==
        undefined &&
      ui.version.trim()
        .length ===
        0
    ) {
      issues.push(
        `UI surface "${kind}" has empty version`
      );
    }
  }

  return {
    valid:
      issues.length ===
        0,
    issues
  };
}

function assertManifest(
  source: string,
  value: unknown
): asserts value is UairPackageManifest {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new Error(
      `Package "${source}" did not export a UAIR manifest object`
    );
  }

  const manifest =
    value as
      UairPackageManifest;

  const validation =
    validateUairPackageManifest(
      manifest
    );

  if (
    !validation.valid
  ) {
    throw new Error(
      `Package "${source}" UAIR manifest is invalid: ${validation.issues.join("; ")}`
    );
  }
}

/**
 * Loads a normal JavaScript/TypeScript package through standard ESM.
 *
 * Contract:
 *   package exports either:
 *
 *     export const uair = { ... }
 *
 *   or:
 *
 *     export default { ... }
 *
 * No custom UAIR registry or package installer is involved.
 */
export async function loadUairPackage(
  specifier: string
): Promise<LoadedUairPackage> {
  const module: any =
    await import(specifier);

  const manifest =
    module.uair ??
    module.default;

  assertManifest(
    specifier,
    manifest
  );

  return {
    source:
      specifier,
    manifest
  };
}

export function collectCapabilities(
  packages:
    LoadedUairPackage[]
) {
  const all:
    Capability[] = [];

  for (const pkg of packages) {
    for (
      const capability
      of pkg.manifest
        .capabilities ?? []
    ) {
      all.push(
        capability
      );
    }
  }

  return new CapabilitySet(
    all
  );
}


/**
 * Convention for normal npm packages:
 *
 * package.json:
 *
 * {
 *   "exports": {
 *     ".": "./dist/index.js",
 *     "./uair": "./dist/uair.js"
 *   }
 * }
 *
 * UAIR first tries the standard ESM subpath "<package>/uair".
 * If that does not exist, it falls back to the package root and looks
 * for `export const uair` / default manifest.
 *
 * This is only an import convention. npm remains responsible for
 * installation, versions, lockfiles, integrity and dependency graphs.
 */
export async function loadInstalledUairPackage(
  packageName: string
): Promise<LoadedUairPackage> {
  const candidates = [
    `${packageName}/uair`,
    packageName
  ];

  let lastError:
    unknown;

  for (const candidate of candidates) {
    try {
      return await loadUairPackage(
        candidate
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Installed package "${packageName}" does not expose a UAIR contract`,
    {
      cause:
        lastError
    }
  );
}
