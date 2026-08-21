import assert from "node:assert/strict";
import {
  component,
  workflow,
  run,
  resume,
  RuntimeEngine,
  WorkflowVersionMismatchError
} from "@uair/core";
import {
  resolveSuspension,
  JsonFileStorage,
  VersionedWorkflowRegistry,
  migrateExecutionHistory,
  builtinHistoryMigrations,
  createDeploymentManifest,
  verifyDeploymentManifest,
  fingerprintWorkflow,
  WorkflowFingerprintMismatchError,
  ExecutionDeploymentMismatchError
} from "@uair/core/runtime";
import {
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  tmpdir
} from "node:os";
import {
  join
} from "node:path";

const waitApproval =
  component<
    {
      request: string;
    },
    {
      approved: boolean;
    }
  >(
    "versioning.approval",
    async (
      input,
      ctx
    ) =>
      ctx.suspend({
        type: "event",
        eventType:
          "approval",
        key:
          input.request
      })
  );

const v1 =
  workflow(
    "versioned.approval",
    {
      version: "1"
    },
    async (
      input: {
        request: string;
      }
    ) => {
      const decision =
        await waitApproval(input);

      return {
        codeVersion: "v1",
        decision
      };
    }
  );

const v2 =
  workflow(
    "versioned.approval",
    {
      version: "2"
    },
    async (
      input: {
        request: string;
      }
    ) => {
      const decision =
        await waitApproval(input);

      return {
        codeVersion: "v2",
        decision,
        newField:
          "new deployment"
      };
    }
  );

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-versioning-"
    )
  );

try {
  const storage =
    new JsonFileStorage(
      join(
        dir,
        "state"
      )
    );

  const suspended =
    await run(
      v1,
      {
        request: "req-1"
      },
      storage
    );

  assert.equal(
    suspended.status,
    "suspended"
  );

  assert.equal(
    suspended.workflowVersion,
    "1"
  );

  assert.equal(
    suspended.historySchemaVersion,
    4
  );

  const suspension =
    suspended.history.find(
      entry =>
        entry.kind ===
        "suspension_created"
    ) as any;

  await resolveSuspension(
    suspension.suspensionId,
    {
      approved: true
    },
    storage
  );

  // Simulate deployment: v2 is now current, but v1 remains registered
  // specifically for executions already pinned to it.
  const registry =
    new VersionedWorkflowRegistry([
      v1,
      v2
    ]);

  const engine =
    new RuntimeEngine(
      storage,
      registry
    );

  await engine.recover();

  const completed =
    await storage
      .loadExecution(
        suspended.id
      );

  assert.equal(
    completed?.status,
    "completed"
  );

  assert.equal(
    (completed?.result as any)
      .codeVersion,
    "v1",
    "old execution must resume with pinned v1 code after v2 deployment"
  );

  // A new execution after deployment can explicitly start on v2.
  const newExecution =
    await run(
      v2,
      {
        request: "req-2"
      },
      storage
    );

  assert.equal(
    newExecution.workflowVersion,
    "2"
  );

  // Supplying the wrong version directly is rejected.
  let mismatch = false;

  try {
    await resume(
      v2,
      suspended.id,
      storage
    );
  } catch (error) {
    mismatch =
      error instanceof
      WorkflowVersionMismatchError;
  }

  assert.equal(
    mismatch,
    true
  );

  // Simulate a pre-versioning persisted record.
  const legacy =
    {
      ...suspended,
      id: "legacy-exp",
      workflowVersion:
        undefined,
      historySchemaVersion:
        undefined
    };

  const migrated =
    migrateExecutionHistory(
      legacy,
      builtinHistoryMigrations
    );

  assert.equal(
    migrated.workflowVersion,
    "1"
  );

  assert.equal(
    migrated.historySchemaVersion,
    4
  );

  // A second old v1 execution demonstrates the alternative:
  // remove v1 code, but register an explicit compatibility upgrade.
  const oldForUpgrade =
    await run(
      v1,
      {
        request: "req-upgrade"
      },
      storage
    );

  const oldSuspension =
    oldForUpgrade.history.find(
      entry =>
        entry.kind ===
        "suspension_created"
    ) as any;

  await resolveSuspension(
    oldSuspension.suspensionId,
    {
      approved: true
    },
    storage
  );

  const upgradedRegistry =
    new VersionedWorkflowRegistry([
      v2
    ]);

  upgradedRegistry
    .registerUpgrade({
      workflow:
        "versioned.approval",
      fromVersion: "1",
      toVersion: "2",
      migrate(execution) {
        // Real migrations may transform input/history-compatible state.
        // This example needs no structural rewrite.
        return {
          ...execution,
          input: {
            ...(execution.input as any)
          },
          history: [
            ...execution.history
          ]
        };
      }
    });

  const upgradedEngine =
    new RuntimeEngine(
      storage,
      upgradedRegistry
    );

  await upgradedEngine.recover();

  const upgradedExecution =
    await storage.loadExecution(
      oldForUpgrade.id
    );

  assert.equal(
    upgradedExecution?.status,
    "completed"
  );

  assert.equal(
    upgradedExecution?.workflowVersion,
    "2"
  );

  assert.equal(
    (
      upgradedExecution
        ?.result as any
    ).codeVersion,
    "v2"
  );

  assert.equal(
    upgradedExecution
      ?.history.some(
        entry =>
          entry.kind ===
          "workflow_upgraded" &&
          entry.fromVersion ===
            "1" &&
          entry.toVersion ===
            "2"
      ),
    true,
    "explicit workflow upgrade must be durable/auditable"
  );

  const manifest =
    createDeploymentManifest(
      "deploy-2026-08-20",
      [
        v1,
        v2
      ]
    );

  assert.equal(
    verifyDeploymentManifest(
      manifest,
      [
        v1,
        v2
      ]
    ),
    true
  );

  const changedV1 =
    workflow(
      "versioned.approval",
      {
        version: "1"
      },
      async (
        input: {
          request: string;
        }
      ) => {
        const decision =
          await waitApproval(input);

        return {
          codeVersion:
            "v1-modified",
          decision
        };
      }
    );

  let registryMismatch =
    false;

  try {
    new VersionedWorkflowRegistry([
      v1,
      changedV1
    ]);
  } catch (error) {
    registryMismatch =
      error instanceof
      WorkflowFingerprintMismatchError;
  }

  assert.equal(
    registryMismatch,
    true,
    "same workflow version with changed code must be rejected at registration"
  );

  const drifted =
    await run(
      v1,
      {
        request:
          "req-fingerprint"
      },
      storage
    );

  assert.equal(
    drifted.workflowFingerprint,
    fingerprintWorkflow(v1)
  );

  let driftRejected =
    false;

  try {
    await resume(
      changedV1,
      drifted.id,
      storage
    );
  } catch (error) {
    driftRejected =
      error instanceof
      ExecutionDeploymentMismatchError;
  }

  assert.equal(
    driftRejected,
    true,
    "pinned execution must reject same-version code drift"
  );

  console.log(
    "UAIR v0.25 deployment identity verification: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
