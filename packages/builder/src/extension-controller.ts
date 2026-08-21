import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  resolve
} from "node:path";

import type {
  CapabilityExtensionAction,
  CapabilityExtensionPlan,
  ReleaseProposal
} from "./types.js";

export type ExtensionActionReceipt = {
  capabilityId: string;
  packageName: string;
  version?: string;
  appliedAt: number;
  evidence?: Record<
    string,
    unknown
  >;
};

export type ExtensionControllerState = {
  proposal:
    ReleaseProposal;
  applied:
    ExtensionActionReceipt[];
};

export interface ExtensionAdapter {
  acquire(
    action:
      CapabilityExtensionAction
  ): Promise<{
    evidence?: Record<
      string,
      unknown
    >;
  }>;
}

/**
 * Reference adapter for CLI/demo use.
 *
 * It does not download packages. Production acquisition is provided by
 * @uair/sandbox using trust + isolated installation.
 */
export class FunctionExtensionAdapter
  implements ExtensionAdapter {
  constructor(
    private readonly fn:
      (
        action:
          CapabilityExtensionAction
      ) => Promise<{
        evidence?: Record<
          string,
          unknown
        >;
      }>
  ) {}

  acquire(
    action:
      CapabilityExtensionAction
  ) {
    return this.fn(
      action
    );
  }
}

export class LocalReceiptExtensionAdapter
  implements ExtensionAdapter {
  async acquire(
    action:
      CapabilityExtensionAction
  ) {
    return {
      evidence: {
        mode:
          "receipt-only",
        packageName:
          action.packageName,
        version:
          action.version
      }
    };
  }
}

export class ExtensionController {
  readonly stateFile:
    string;

  constructor(
    private readonly options: {
      stateDir: string;
      adapter:
        ExtensionAdapter;
    }
  ) {
    this.stateFile =
      resolve(
        options.stateDir,
        "extension-state.json"
      );
  }

  async saveProposal(
    proposal:
      ReleaseProposal
  ) {
    const state:
      ExtensionControllerState = {
        proposal,
        applied: []
      };

    await this.writeState(
      state
    );

    return state;
  }

  async loadState() {
    return JSON.parse(
      await readFile(
        this.stateFile,
        "utf8"
      )
    ) as
      ExtensionControllerState;
  }

  async review() {
    const state =
      await this.loadState();

    const plan =
      state.proposal
        .extensionPlan;

    return {
      required:
        plan?.required ??
        false,
      actions:
        plan?.actions ??
        [],
      applied:
        state.applied
    };
  }

  async satisfied() {
    const state =
      await this.loadState();

    const actions =
      state.proposal
        .extensionPlan
        ?.actions ??
      [];

    return actions.every(
      action =>
        state.applied.some(
          item =>
            item.capabilityId ===
              action.capabilityId &&
            item.packageName ===
              action.packageName &&
            item.version ===
              action.version
        )
    );
  }

  /**
   * Apply an already-planned extension action.
   *
   * `approved` is release/operator intent, not a security authorization.
   * Production adapters must independently enforce package trust, provenance,
   * sandbox and capability policy before acquisition/activation.
   */
  async apply(
    approved:
      boolean
  ) {
    if (!approved) {
      throw new Error(
        "Capability extension requires explicit approval."
      );
    }

    const state =
      await this.loadState();

    const plan:
      CapabilityExtensionPlan | undefined =
      state.proposal
        .extensionPlan;

    if (
      !plan ||
      !plan.required ||
      plan.actions.length ===
        0
    ) {
      return state.applied;
    }

    for (
      const action
      of plan.actions
    ) {
      const already =
        state.applied.some(
          item =>
            item.capabilityId ===
              action.capabilityId &&
            item.packageName ===
              action.packageName &&
            item.version ===
              action.version
        );

      if (already) {
        continue;
      }

      const result =
        await this.options
          .adapter
          .acquire(
            action
          );

      state.applied.push({
        capabilityId:
          action.capabilityId,
        packageName:
          action.packageName,
        version:
          action.version,
        appliedAt:
          Date.now(),
        evidence:
          result.evidence
      });

      await this.writeState(
        state
      );
    }

    return state.applied;
  }

  private async writeState(
    state:
      ExtensionControllerState
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
