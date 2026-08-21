import type {
  CapabilityResolver
} from "@uair/package";

export type CapabilityNeed = {
  query: string;
  requiredKind?:
    | "tool"
    | "ui"
    | "workflow"
    | "service";
  constraints?: string[];
};

export type GeneratedFile = {
  path: string;
  content: string;
};

export type PackageDraft = {
  packageName: string;
  capabilityId: string;
  description?: string;
  files: GeneratedFile[];
};

export type ForgeInspection = {
  allowed: boolean;
  reasons: string[];
};

export type ForgeBuildResult = {
  ok: boolean;
  installDir?: string;
  stdout?: string;
  stderr?: string;
};

export interface PackageSynthesizer {
  synthesize(
    need: CapabilityNeed
  ): Promise<PackageDraft>;
}

export interface ForgeInspector {
  inspect(
    draft: PackageDraft
  ): Promise<ForgeInspection>;
}

export interface ForgeSandbox {
  buildAndTest(
    draft: PackageDraft
  ): Promise<ForgeBuildResult>;
}

export interface ForgeApprovalPolicy {
  approve(
    input: {
      need: CapabilityNeed;
      draft: PackageDraft;
      inspection:
        ForgeInspection;
      build:
        ForgeBuildResult;
    }
  ): Promise<
    {
      approved: boolean;
      reason?: string;
    }
  >;
}

export interface ForgeActivator {
  activate(
    input: {
      draft: PackageDraft;
      installDir: string;
    }
  ): Promise<{
    manifest: {
      capabilities?: any[];
    };
  }>;
}


export interface ForgePackageAcquirer {
  acquire(
    candidate: any
  ): Promise<unknown>;
}

export type CapabilityResolution =
  | {
      kind: "existing";
      candidate: any;
    }
  | {
      kind: "installed";
      candidate: any;
      package: unknown;
    }
  | {
      kind: "generated";
      draft: PackageDraft;
      package: unknown;
    }
  | {
      kind: "unavailable";
      reason: string;
    };

/**
 * The safe synthesis order is deliberately fixed:
 *
 * discover executable -> acquire trusted installable package
 * -> synthesize only if still missing -> inspect -> sandbox build/test
 * -> approve -> activate -> register
 *
 * Generated code is never executed in the host process before
 * inspection, sandbox validation and approval have all succeeded.
 */
export async function resolveOrForgeCapability(
  need: CapabilityNeed,
  deps: {
    resolver:
      CapabilityResolver;
    acquire?:
      ForgePackageAcquirer;
    synthesize:
      PackageSynthesizer;
    inspect:
      ForgeInspector;
    sandbox:
      ForgeSandbox;
    approval:
      ForgeApprovalPolicy;
    activate:
      ForgeActivator;
  }
): Promise<CapabilityResolution> {
  const candidates =
    await deps.resolver
      .discover(
        need.query
      );

  const executable =
    candidates.find(
      candidate =>
        candidate.executable
    );

  if (executable) {
    return {
      kind: "existing",
      candidate:
        executable
    };
  }

  const installable =
    candidates.find(
      candidate =>
        candidate.sourceKind ===
          "installable-package"
    );

  if (
    installable &&
    deps.acquire
  ) {
    const pkg =
      await deps.acquire
        .acquire(
          installable
        );

    return {
      kind:
        "installed",
      candidate:
        installable,
      package:
        pkg
    };
  }

  const draft =
    await deps.synthesize
      .synthesize(
        need
      );

  const inspection =
    await deps.inspect
      .inspect(
        draft
      );

  if (
    !inspection.allowed
  ) {
    return {
      kind: "unavailable",
      reason:
        inspection.reasons
          .join("; ")
    };
  }

  const build =
    await deps.sandbox
      .buildAndTest(
        draft
      );

  if (
    !build.ok ||
    !build.installDir
  ) {
    return {
      kind: "unavailable",
      reason:
        build.stderr ??
        "Sandbox build/test failed"
    };
  }

  const decision =
    await deps.approval
      .approve({
        need,
        draft,
        inspection,
        build
      });

  if (!decision.approved) {
    return {
      kind: "unavailable",
      reason:
        decision.reason ??
        "Generated package activation denied"
    };
  }

  const pkg =
    await deps.activate
      .activate({
        draft,
        installDir:
          build.installDir
      });

  deps.resolver.addPackage(
    pkg as any
  );

  return {
    kind: "generated",
    draft,
    package:
      pkg
  };
}
