import type {
  Execution,
  HistoryEntry,
  WorkflowDefinition
} from "./types.js";
import {
  fingerprintWorkflow,
  WorkflowFingerprintMismatchError
} from "./deployment.js";

export const CURRENT_HISTORY_SCHEMA_VERSION =
  4;

export type HistoryMigration = {
  from: number;
  to: number;
  migrate(
    execution: Execution
  ): Execution;
};

export class HistorySchemaTooNewError
  extends Error {
  constructor(
    readonly executionId:
      string,
    readonly found:
      number,
    readonly supported:
      number
  ) {
    super(
      `Execution ${executionId} uses History schema ${found}, newer than supported schema ${supported}.`
    );

    this.name =
      "HistorySchemaTooNewError";
  }
}

export class HistoryMigrationError
  extends Error {
  constructor(
    readonly executionId: string,
    readonly from: number,
    readonly target: number
  ) {
    super(
      `No history migration path for execution ${executionId}: ${from} -> ${target}`
    );

    this.name =
      "HistoryMigrationError";
  }
}

export function migrateExecutionHistory(
  execution: Execution,
  migrations:
    HistoryMigration[],
  target =
    CURRENT_HISTORY_SCHEMA_VERSION
) {
  let version =
    execution
      .historySchemaVersion ??
    1;

  let current =
    execution;

  if (
    version > target
  ) {
    throw new HistorySchemaTooNewError(
      execution.id,
      version,
      target
    );
  }

  while (
    version < target
  ) {
    const migration =
      migrations.find(
        item =>
          item.from ===
            version
      );

    if (!migration) {
      throw new HistoryMigrationError(
        execution.id,
        version,
        target
      );
    }

    current =
      migration.migrate(
        current
      );

    version =
      migration.to;

    current
      .historySchemaVersion =
      version;
  }

  return current;
}

/**
 * Built-in additive migration for records created before v0.22/v0.24.
 * New timing/observability/version fields are optional, so schema 1
 * records require only explicit schema normalization.
 */
export type WorkflowUpgrade = {
  workflow: string;
  fromVersion: string;
  toVersion: string;
  migrate(
    execution: Execution
  ): Execution;
};

export const builtinHistoryMigrations:
  HistoryMigration[] = [
    {
      from: 1,
      to: 2,
      migrate(execution) {
        return {
          ...execution,
          workflowVersion:
            execution
              .workflowVersion ??
            "1",
          history:
            execution.history
              .map(
                entry => ({
                  ...entry
                } as HistoryEntry)
              )
        };
      }
    },
    {
      from: 2,
      to: 3,
      migrate(execution) {
        return {
          ...execution,
          history: [
            ...execution.history
          ]
        };
      }
    },
    {
      from: 3,
      to: 4,
      migrate(execution) {
        return {
          ...execution,
          history: [
            ...execution.history
          ]
        };
      }
    }
  ];

export class VersionedWorkflowRegistry {
  private readonly workflows =
    new Map<
      string,
      Map<
        string,
        WorkflowDefinition<any, any>
      >
    >();

  private readonly upgrades =
    new Map<
      string,
      WorkflowUpgrade
    >();

  constructor(
    definitions:
      WorkflowDefinition<any, any>[] = []
  ) {
    for (
      const definition
      of definitions
    ) {
      this.register(
        definition
      );
    }
  }

  register(
    definition:
      WorkflowDefinition<any, any>
  ) {
    let versions =
      this.workflows.get(
        definition.name
      );

    const existing =
      versions?.get(
        definition.version
      );

    if (existing) {
      const expected =
        fingerprintWorkflow(
          existing
        );

      const actual =
        fingerprintWorkflow(
          definition
        );

      if (
        expected !== actual
      ) {
        throw new WorkflowFingerprintMismatchError(
          definition.name,
          definition.version,
          expected,
          actual
        );
      }

      return this;
    }

    if (!versions) {
      versions =
        new Map();

      this.workflows.set(
        definition.name,
        versions
      );
    }

    versions.set(
      definition.version,
      definition
    );

    return this;
  }

  resolve(
    workflowName: string,
    version: string
  ) {
    return this.workflows
      .get(
        workflowName
      )
      ?.get(
        version
      );
  }

  resolveExecution(
    execution: Execution
  ) {
    const version =
      execution
        .workflowVersion ??
      "1";

    return this.resolve(
      execution.workflow,
      version
    );
  }

  registerUpgrade(
    upgrade: WorkflowUpgrade
  ) {
    this.upgrades.set(
      `${upgrade.workflow}@${upgrade.fromVersion}`,
      upgrade
    );

    return this;
  }

  upgradeExecution(
    execution: Execution
  ) {
    const fromVersion =
      execution.workflowVersion ??
      "1";

    const upgrade =
      this.upgrades.get(
        `${execution.workflow}@${fromVersion}`
      );

    if (!upgrade) {
      return null;
    }

    const target =
      this.resolve(
        execution.workflow,
        upgrade.toVersion
      );

    if (!target) {
      throw new Error(
        `Workflow upgrade target not registered: ` +
        `${execution.workflow}@${upgrade.toVersion}`
      );
    }

    const migrated =
      upgrade.migrate(
        execution
      );

    const fromFingerprint =
      migrated.workflowFingerprint;

    const toFingerprint =
      fingerprintWorkflow(
        target
      );

    migrated.workflowVersion =
      upgrade.toVersion;

    migrated.workflowFingerprint =
      toFingerprint;

    migrated.deploymentId =
      target.deploymentId;

    migrated.history.push({
      kind: "workflow_upgraded",
      workflow:
        execution.workflow,
      fromVersion,
      toVersion:
        upgrade.toVersion,
      fromFingerprint,
      toFingerprint,
      upgradedAt:
        Date.now()
    });

    return {
      execution:
        migrated,
      workflow:
        target
    };
  }

  list(
    workflowName?: string
  ) {
    const result:
      WorkflowDefinition<any, any>[] =
        [];

    for (
      const [name, versions]
      of this.workflows
    ) {
      if (
        workflowName &&
        name !== workflowName
      ) {
        continue;
      }

      result.push(
        ...versions.values()
      );
    }

    return result;
  }
}
