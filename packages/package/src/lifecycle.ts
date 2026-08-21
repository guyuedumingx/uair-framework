import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  resolve
} from "node:path";

export type PackageLifecyclePhase =
  | "created"
  | "verified"
  | "packed"
  | "published"
  | "installed"
  | "upgraded"
  | "rolled-back";

export type PackageLifecycleReceipt = {
  phase:
    PackageLifecyclePhase;
  packageName: string;
  version: string;
  previousVersion?: string;
  at: number;
  evidence?: Record<
    string,
    unknown
  >;
};

export type PackageLifecycleState = {
  packageName: string;
  currentVersion?: string;
  previousVersion?: string;
  receipts:
    PackageLifecycleReceipt[];
};

export interface PackageLifecycleAdapter {
  verify?(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
    }
  ): Promise<{
    evidence?: Record<
      string,
      unknown
    >;
  }>;

  pack?(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
    }
  ): Promise<{
    artifact?: string;
    integrity?: string;
    evidence?: Record<
      string,
      unknown
    >;
  }>;

  publish?(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
      artifact?: string;
    }
  ): Promise<{
    registry?: string;
    provenance?: Record<
      string,
      unknown
    >;
    evidence?: Record<
      string,
      unknown
    >;
  }>;

  install?(
    input: {
      packageName: string;
      version: string;
    }
  ): Promise<{
    evidence?: Record<
      string,
      unknown
    >;
  }>;
}

export class PackageLifecycleController {
  readonly stateFile:
    string;

  constructor(
    private readonly options: {
      stateFile: string;
      adapter:
        PackageLifecycleAdapter;
    }
  ) {
    this.stateFile =
      resolve(
        options.stateFile
      );
  }

  async loadState(
    packageName:
      string
  ): Promise<
    PackageLifecycleState
  > {
    try {
      return JSON.parse(
        await readFile(
          this.stateFile,
          "utf8"
        )
      );
    } catch (
      error: any
    ) {
      if (
        error?.code ===
          "ENOENT"
      ) {
        return {
          packageName,
          receipts: []
        };
      }

      throw error;
    }
  }

  async create(
    input: {
      packageName: string;
      version: string;
      evidence?: Record<
        string,
        unknown
      >;
    }
  ) {
    const state =
      await this.loadState(
        input.packageName
      );

    this.record(
      state,
      {
        phase:
          "created",
        packageName:
          input.packageName,
        version:
          input.version,
        at:
          Date.now(),
        evidence:
          input.evidence
      }
    );

    await this.writeState(
      state
    );

    return state;
  }

  async verify(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
    }
  ) {
    const state =
      await this.loadState(
        input.packageName
      );

    const result =
      await this.options
        .adapter
        .verify?.(
          input
        ) ?? {};

    this.record(
      state,
      {
        phase:
          "verified",
        packageName:
          input.packageName,
        version:
          input.version,
        at:
          Date.now(),
        evidence:
          result.evidence
      }
    );

    await this.writeState(
      state
    );

    return result;
  }

  async pack(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
    }
  ) {
    const state =
      await this.loadState(
        input.packageName
      );

    const result =
      await this.options
        .adapter
        .pack?.(
          input
        ) ?? {};

    this.record(
      state,
      {
        phase:
          "packed",
        packageName:
          input.packageName,
        version:
          input.version,
        at:
          Date.now(),
        evidence: {
          artifact:
            result.artifact,
          integrity:
            result.integrity,
          ...(
            result.evidence ??
            {}
          )
        }
      }
    );

    await this.writeState(
      state
    );

    return result;
  }

  async publish(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
      artifact?: string;
      approved: boolean;
    }
  ) {
    if (
      !input.approved
    ) {
      throw new Error(
        "Package publish requires explicit approval."
      );
    }

    const state =
      await this.loadState(
        input.packageName
      );

    const verified =
      state.receipts.some(
        receipt =>
          receipt.phase ===
            "verified" &&
          receipt.version ===
            input.version
      );

    const packed =
      state.receipts.some(
        receipt =>
          receipt.phase ===
            "packed" &&
          receipt.version ===
            input.version
      );

    if (
      !verified ||
      !packed
    ) {
      throw new Error(
        `Package ${input.packageName}@${input.version} must be verified and packed before publish.`
      );
    }

    const existingPublication =
      state.receipts.find(
        receipt =>
          receipt.phase ===
            "published" &&
          receipt.version ===
            input.version
      );

    if (
      existingPublication
    ) {
      return {
        alreadyPublished:
          true,
        evidence:
          existingPublication
            .evidence
      };
    }

    const result =
      await this.options
        .adapter
        .publish?.({
          packageDir:
            input.packageDir,
          packageName:
            input.packageName,
          version:
            input.version,
          artifact:
            input.artifact
        }) ?? {};

    this.record(
      state,
      {
        phase:
          "published",
        packageName:
          input.packageName,
        version:
          input.version,
        at:
          Date.now(),
        evidence: {
          registry:
            result.registry,
          provenance:
            result.provenance,
          ...(
            result.evidence ??
            {}
          )
        }
      }
    );

    await this.writeState(
      state
    );

    return result;
  }

  async install(
    input: {
      packageName: string;
      version: string;
      approved: boolean;
    }
  ) {
    if (
      !input.approved
    ) {
      throw new Error(
        "Package install requires explicit approval."
      );
    }

    const state =
      await this.loadState(
        input.packageName
      );

    if (
      state.currentVersion ===
        input.version
    ) {
      return state;
    }

    const previousVersion =
      state.currentVersion;

    const result =
      await this.options
        .adapter
        .install?.({
          packageName:
            input.packageName,
          version:
            input.version
        }) ?? {};

    state.previousVersion =
      previousVersion;

    state.currentVersion =
      input.version;

    this.record(
      state,
      {
        phase:
          previousVersion
            ? "upgraded"
            : "installed",
        packageName:
          input.packageName,
        version:
          input.version,
        previousVersion,
        at:
          Date.now(),
        evidence:
          result.evidence
      }
    );

    await this.writeState(
      state
    );

    return state;
  }

  async rollback(
    input: {
      packageName: string;
      approved: boolean;
    }
  ) {
    if (
      !input.approved
    ) {
      throw new Error(
        "Package rollback requires explicit approval."
      );
    }

    const state =
      await this.loadState(
        input.packageName
      );

    const target =
      state.previousVersion;

    if (!target) {
      throw new Error(
        `Package ${input.packageName} has no previous version to roll back to.`
      );
    }

    const current =
      state.currentVersion;

    const lastReceipt =
      state.receipts
        .at(-1);

    if (
      lastReceipt
        ?.phase ===
        "rolled-back" &&
      lastReceipt.version ===
        current &&
      lastReceipt
        .previousVersion ===
        target
    ) {
      return state;
    }

    await this.options
      .adapter
      .install?.({
        packageName:
          input.packageName,
        version:
          target
      });

    state.currentVersion =
      target;

    state.previousVersion =
      current;

    this.record(
      state,
      {
        phase:
          "rolled-back",
        packageName:
          input.packageName,
        version:
          target,
        previousVersion:
          current,
        at:
          Date.now()
      }
    );

    await this.writeState(
      state
    );

    return state;
  }

  private record(
    state:
      PackageLifecycleState,
    receipt:
      PackageLifecycleReceipt
  ) {
    const duplicate =
      state.receipts.some(
        item =>
          item.phase ===
            receipt.phase &&
          item.version ===
            receipt.version &&
          item.previousVersion ===
            receipt.previousVersion
      );

    if (!duplicate) {
      state.receipts.push(
        receipt
      );
    }
  }

  private async writeState(
    state:
      PackageLifecycleState
  ) {
    await mkdir(
      dirname(
        this.stateFile
      ),
      {
        recursive: true
      }
    );

    await writeFile(
      this.stateFile,
      JSON.stringify(
        state,
        null,
        2
      ) +
      "\n",
      "utf8"
    );
  }
}
