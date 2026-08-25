import {
  DatabaseSync
} from "node:sqlite";
import {
  dirname
} from "node:path";
import {
  mkdirSync
} from "node:fs";

import type { Execution } from "@uair/core";
import type {
  SuspensionCreated,
  Storage,
  InboxStore,
  InboxRecord,
  OutboxStore,
  OutboxRecord,
  EventReceiptStore,
  ExternalEvent
} from "@uair/core/runtime";
import { StorageConflictError } from "@uair/core/runtime";
import { currentFence, StaleFenceError } from "@uair/core/adapter";


export const SQLITE_RUNTIME_SCHEMA_VERSION =
  2;

export class SqliteRuntimeSchemaTooNewError
  extends Error {
  constructor(
    readonly found: number,
    readonly supported:
      number
  ) {
    super(
      `SQLite Runtime schema ${found} is newer than supported schema ${supported}.`
    );

    this.name =
      "SqliteRuntimeSchemaTooNewError";
  }
}

function encode(
  value: unknown
): string | null {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function decode<T>(
  value: unknown
): T | undefined {
  if (
    value === null ||
    value === undefined
  ) {
    return undefined;
  }

  return JSON.parse(
    String(value)
  ) as T;
}


export type SqliteRuntimeFaultPoint =
  | "save-execution:after-upsert"
  | "save-and-index:after-upsert"
  | "save-and-index:after-index"
  | "save-and-remove:after-upsert"
  | "save-and-remove:after-remove";

export type SqliteRuntimeStateOptions = {
  /**
   * Fault-injection hook used by crash/recovery verification.
   * It is outside Core semantics and is never invoked unless supplied.
   */
  faultInjector?:
    (
      point:
        SqliteRuntimeFaultPoint
    ) => void;
};

export class SqliteRuntimeState
  implements Storage {
  readonly db: DatabaseSync;

  constructor(
    readonly file =
      ".uair/uair.sqlite",
    private readonly options:
      SqliteRuntimeStateOptions =
        {}
  ) {
    mkdirSync(
      dirname(file),
      {
        recursive: true
      }
    );

    this.db =
      new DatabaseSync(file);

    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);

    this.migrate();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS uair_runtime_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const versionRow =
      this.db.prepare(`
        SELECT value
        FROM uair_runtime_meta
        WHERE key =
          'runtime_schema_version'
      `).get() as
        | {
            value:
              string;
          }
        | undefined;

    const found =
      versionRow
        ? Number(
            versionRow.value
          )
        : 0;

    if (
      found >
      SQLITE_RUNTIME_SCHEMA_VERSION
    ) {
      throw new SqliteRuntimeSchemaTooNewError(
        found,
        SQLITE_RUNTIME_SCHEMA_VERSION
      );
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        workflow TEXT NOT NULL,
        workflow_version TEXT,
        deployment_id TEXT,
        workflow_fingerprint TEXT,
        history_schema_version INTEGER,
        input_json TEXT,
        status TEXT NOT NULL,
        history_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS suspensions (
        suspension_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        path TEXT NOT NULL,
        component TEXT NOT NULL,
        effect_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        spec_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        result_valid_for_ms INTEGER,
        FOREIGN KEY(execution_id)
          REFERENCES executions(id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_suspensions_execution
        ON suspensions(execution_id);

      CREATE INDEX IF NOT EXISTS idx_suspensions_timer
        ON suspensions(expires_at);

      CREATE TABLE IF NOT EXISTS inbox (
        event_id TEXT PRIMARY KEY,
        event_json TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        consumed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_inbox_pending
        ON inbox(consumed_at);

      CREATE TABLE IF NOT EXISTS event_receipts (
        event_id TEXT PRIMARY KEY,
        processed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        execution_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        FOREIGN KEY(execution_id)
          REFERENCES executions(id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_pending
        ON outbox(delivered_at);

      CREATE TABLE IF NOT EXISTS runtime_locks (
        lock_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        fence_token INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL
      );
    `);

    for (const sql of [
      "ALTER TABLE executions ADD COLUMN workflow_version TEXT",
      "ALTER TABLE executions ADD COLUMN deployment_id TEXT",
      "ALTER TABLE executions ADD COLUMN workflow_fingerprint TEXT",
      "ALTER TABLE executions ADD COLUMN history_schema_version INTEGER"
    ]) {
      try {
        this.db.exec(sql);
      } catch (error: any) {
        if (
          !String(
            error?.message ?? error
          ).includes(
            "duplicate column name"
          )
        ) {
          throw error;
        }
      }
    }

    this.db.prepare(`
      INSERT INTO uair_runtime_meta (
        key,
        value
      )
      VALUES (
        'runtime_schema_version',
        ?
      )
      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value
    `).run(
      String(
        SQLITE_RUNTIME_SCHEMA_VERSION
      )
    );
  }

  private fault(
    point:
      SqliteRuntimeFaultPoint
  ) {
    this.options
      .faultInjector?.(
        point
      );
  }

  private transaction<T>(
    fn: () => T
  ): T {
    this.db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const value = fn();

      this.db.exec(
        "COMMIT"
      );

      return value;
    } catch (error) {
      this.db.exec(
        "ROLLBACK"
      );

      throw error;
    }
  }

  private rowToExecution(
    row: any
  ): Execution {
    return {
      id: String(row.id),
      workflow:
        String(row.workflow),
      workflowVersion:
        row.workflow_version ===
          null ||
        row.workflow_version ===
          undefined
          ? undefined
          : String(
              row.workflow_version
            ),
      deploymentId:
        row.deployment_id == null
          ? undefined
          : String(
              row.deployment_id
            ),
      workflowFingerprint:
        row.workflow_fingerprint == null
          ? undefined
          : String(
              row.workflow_fingerprint
            ),
      historySchemaVersion:
        row.history_schema_version ===
          null ||
        row.history_schema_version ===
          undefined
          ? undefined
          : Number(
              row.history_schema_version
            ),
      input:
        decode(row.input_json),
      status:
        row.status,
      history:
        decode(row.history_json) ??
        [],
      result:
        decode(row.result_json),
      error:
        decode(row.error_json),
      revision:
        Number(row.revision)
    };
  }

  private assertFence(
    executionId: string
  ) {
    const fence =
      currentFence();

    if (!fence) {
      return;
    }

    if (
      fence.lockKey !==
      `execution:${executionId}`
    ) {
      return;
    }

    const row =
      this.db.prepare(`
        SELECT
          owner,
          fence_token,
          expires_at
        FROM runtime_locks
        WHERE lock_key = ?
      `).get(
        fence.lockKey
      ) as any;

    if (
      !row ||
      String(row.owner) !==
        fence.owner ||
      Number(
        row.fence_token
      ) !== fence.token ||
      Number(
        row.expires_at
      ) <= Date.now()
    ) {
      throw new StaleFenceError(
        `Stale execution fence for ${executionId}. ` +
        `owner=${fence.owner}, token=${fence.token}`
      );
    }
  }

  private upsertExecution(
    execution: Execution,
    expectedRevision?: number
  ) {
    this.assertFence(
      execution.id
    );

    const current =
      this.db.prepare(`
        SELECT revision
        FROM executions
        WHERE id = ?
      `).get(
        execution.id
      ) as any;

    const currentRevision =
      current
        ? Number(
            current.revision
          )
        : 0;

    if (
      expectedRevision !==
        undefined &&
      currentRevision !==
        expectedRevision
    ) {
      throw new StorageConflictError(
        `Execution ${execution.id} revision conflict. ` +
        `Expected ${expectedRevision}, found ${currentRevision}.`
      );
    }

    const nextRevision =
      currentRevision + 1;

    this.db.prepare(`
      INSERT INTO executions (
        id,
        workflow,
        workflow_version,
        deployment_id,
        workflow_fingerprint,
        history_schema_version,
        input_json,
        status,
        history_json,
        result_json,
        error_json,
        revision,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow = excluded.workflow,
        workflow_version = excluded.workflow_version,
        deployment_id = excluded.deployment_id,
        workflow_fingerprint = excluded.workflow_fingerprint,
        history_schema_version = excluded.history_schema_version,
        input_json = excluded.input_json,
        status = excluded.status,
        history_json = excluded.history_json,
        result_json = excluded.result_json,
        error_json = excluded.error_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(
      execution.id,
      execution.workflow,
      execution.workflowVersion ??
        null,
      execution.deploymentId ??
        null,
      execution.workflowFingerprint ??
        null,
      execution.historySchemaVersion ??
        null,
      encode(
        execution.input
      ),
      execution.status,
      encode(
        execution.history
      )!,
      encode(
        execution.result
      ),
      encode(
        execution.error
      ),
      nextRevision,
      Date.now()
    );

    execution.revision =
      nextRevision;
  }

  async loadExecution(
    id: string
  ): Promise<Execution | null> {
    const row =
      this.db.prepare(`
        SELECT *
        FROM executions
        WHERE id = ?
      `).get(id);

    return row
      ? this.rowToExecution(
          row
        )
      : null;
  }

  async saveExecution(
    execution: Execution,
    expectedRevision?: number
  ): Promise<void> {
    this.transaction(
      () => {
        this.upsertExecution(
          execution,
          expectedRevision
        );

        this.fault(
          "save-execution:after-upsert"
        );
      }
    );
  }

  async listExecutions():
    Promise<Execution[]> {
    const rows =
      this.db.prepare(`
        SELECT *
        FROM executions
        ORDER BY updated_at
      `).all();

    return rows.map(
      row =>
        this.rowToExecution(
          row
        )
    );
  }

  private insertSuspension(
    executionId: string,
    suspension:
      SuspensionCreated
  ) {
    this.db.prepare(`
      INSERT OR REPLACE
      INTO suspensions (
        suspension_id,
        execution_id,
        path,
        component,
        effect_id,
        generation,
        spec_json,
        created_at,
        expires_at,
        result_valid_for_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      suspension.suspensionId,
      executionId,
      suspension.path,
      suspension.component,
      suspension.effectId,
      suspension.generation,
      encode(
        suspension.spec
      ),
      suspension.createdAt,
      suspension.expiresAt ??
        null,
      suspension.resultValidForMs ??
        null
    );
  }

  async indexSuspension(
    executionId: string,
    suspension:
      SuspensionCreated
  ): Promise<void> {
    this.transaction(
      () => {
        this.insertSuspension(
          executionId,
          suspension
        );
      }
    );
  }

  async removeSuspensionIndex(
    suspensionId: string
  ): Promise<void> {
    this.transaction(
      () => {
        this.db.prepare(`
          DELETE FROM suspensions
          WHERE suspension_id = ?
        `).run(
          suspensionId
        );
      }
    );
  }

  async findSuspension(
    suspensionId: string
  ) {
    const row =
      this.db.prepare(`
        SELECT *
        FROM suspensions
        WHERE suspension_id = ?
      `).get(
        suspensionId
      ) as any;

    if (!row) {
      return null;
    }

    return {
      executionId:
        String(
          row.execution_id
        ),
      suspension: {
        kind:
          "suspension_created" as const,
        path:
          String(row.path),
        component:
          String(row.component),
        effectId:
          String(row.effect_id),
        generation:
          Number(
            row.generation
          ),
        suspensionId:
          String(
            row.suspension_id
          ),
        createdAt:
          Number(
            row.created_at
          ),
        expiresAt:
          row.expires_at ===
          null
            ? undefined
            : Number(
                row.expires_at
              ),
        resultValidForMs:
          row.result_valid_for_ms ===
          null
            ? undefined
            : Number(
                row.result_valid_for_ms
              ),
        spec:
          decode(
            row.spec_json
          )
      }
    };
  }

  async listSuspensions() {
    const rows =
      this.db.prepare(`
        SELECT *
        FROM suspensions
        ORDER BY created_at
      `).all() as any[];

    return rows.map(
      row => ({
        executionId:
          String(
            row.execution_id
          ),
        suspension: {
          kind:
            "suspension_created" as const,
          path:
            String(row.path),
          component:
            String(
              row.component
            ),
          effectId:
            String(
              row.effect_id
            ),
          generation:
            Number(
              row.generation
            ),
          suspensionId:
            String(
              row.suspension_id
            ),
          createdAt:
            Number(
              row.created_at
            ),
          expiresAt:
            row.expires_at ===
            null
              ? undefined
              : Number(
                  row.expires_at
                ),
          resultValidForMs:
            row.result_valid_for_ms ===
            null
              ? undefined
              : Number(
                  row.result_valid_for_ms
                ),
          spec:
            decode(
              row.spec_json
            )
        }
      })
    );
  }

  async saveExecutionAndIndexSuspension(
    execution: Execution,
    suspension:
      SuspensionCreated,
    expectedRevision?: number
  ): Promise<void> {
    this.transaction(
      () => {
        this.upsertExecution(
          execution,
          expectedRevision
        );

        this.fault(
          "save-and-index:after-upsert"
        );

        this.insertSuspension(
          execution.id,
          suspension
        );

        this.fault(
          "save-and-index:after-index"
        );
      }
    );
  }

  async saveExecutionAndRemoveSuspension(
    execution: Execution,
    suspensionId: string,
    expectedRevision?: number
  ): Promise<void> {
    this.transaction(
      () => {
        this.upsertExecution(
          execution,
          expectedRevision
        );

        this.fault(
          "save-and-remove:after-upsert"
        );

        this.db.prepare(`
          DELETE FROM suspensions
          WHERE suspension_id = ?
        `).run(
          suspensionId
        );

        this.fault(
          "save-and-remove:after-remove"
        );
      }
    );
  }

  // InboxStore
  async put(
    event: ExternalEvent
  ): Promise<void> {
    this.transaction(
      () => {
        this.db.prepare(`
          INSERT OR IGNORE
          INTO inbox (
            event_id,
            event_json,
            received_at
          )
          VALUES (?, ?, ?)
        `).run(
          event.id,
          encode(event)!,
          Date.now()
        );
      }
    );
  }


  async markConsumed(
    eventId: string
  ): Promise<void> {
    this.transaction(
      () => {
        this.db.prepare(`
          UPDATE inbox
          SET consumed_at = ?
          WHERE event_id = ?
            AND consumed_at IS NULL
        `).run(
          Date.now(),
          eventId
        );
      }
    );
  }

  // EventReceiptStore
  async has(
    eventId: string
  ): Promise<boolean> {
    const row =
      this.db.prepare(`
        SELECT 1
        FROM event_receipts
        WHERE event_id = ?
      `).get(
        eventId
      );

    return !!row;
  }

  async record(
    eventId: string
  ): Promise<void> {
    this.transaction(
      () => {
        this.db.prepare(`
          INSERT OR IGNORE
          INTO event_receipts (
            event_id,
            processed_at
          )
          VALUES (?, ?)
        `).run(
          eventId,
          Date.now()
        );
      }
    );
  }

  // OutboxStore
  async ensure(
    requestId: string,
    executionId: string,
    reason:
      | "event"
      | "timer"
      | "manual"
      | "recovery"
  ): Promise<OutboxRecord> {
    return this.transaction(
      () => {
        this.db.prepare(`
          INSERT OR IGNORE
          INTO outbox (
            id,
            request_id,
            execution_id,
            reason,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(
          `out_${requestId}`,
          requestId,
          executionId,
          reason,
          Date.now()
        );

        const row =
          this.db.prepare(`
            SELECT *
            FROM outbox
            WHERE request_id = ?
          `).get(
            requestId
          ) as any;

        return {
          id:
            String(row.id),
          requestId:
            String(
              row.request_id
            ),
          executionId:
            String(
              row.execution_id
            ),
          reason:
            row.reason,
          createdAt:
            Number(
              row.created_at
            ),
          deliveredAt:
            row.delivered_at ===
            null
              ? undefined
              : Number(
                  row.delivered_at
                )
        };
      }
    );
  }

  async hasRequest(
    requestId: string
  ): Promise<boolean> {
    const row =
      this.db.prepare(`
        SELECT 1
        FROM outbox
        WHERE request_id = ?
      `).get(
        requestId
      );

    return !!row;
  }

  async markDelivered(
    id: string
  ): Promise<void> {
    this.transaction(
      () => {
        this.db.prepare(`
          UPDATE outbox
          SET delivered_at = ?
          WHERE id = ?
            AND delivered_at IS NULL
        `).run(
          Date.now(),
          id
        );
      }
    );
  }

  inboxView(): InboxStore {
    return {
      put:
        event =>
          this.put(event),

      listPending:
        async () => {
          const rows =
            this.db.prepare(`
              SELECT *
              FROM inbox
              WHERE consumed_at IS NULL
              ORDER BY received_at
            `).all() as any[];

          return rows.map(
            row => ({
              event:
                decode<ExternalEvent>(
                  row.event_json
                )!,
              receivedAt:
                Number(
                  row.received_at
                ),
              consumedAt:
                row.consumed_at ===
                null
                  ? undefined
                  : Number(
                      row.consumed_at
                    )
            })
          );
        },

      markConsumed:
        eventId =>
          this.markConsumed(
            eventId
          )
    };
  }

  outboxView(): OutboxStore {
    return {
      ensure:
        (
          requestId,
          executionId,
          reason
        ) =>
          this.ensure(
            requestId,
            executionId,
            reason
          ),

      listPending:
        async () => {
          const rows =
            this.db.prepare(`
              SELECT *
              FROM outbox
              WHERE delivered_at IS NULL
              ORDER BY created_at
            `).all() as any[];

          return rows.map(
            row => ({
              id:
                String(row.id),
              requestId:
                String(
                  row.request_id
                ),
              executionId:
                String(
                  row.execution_id
                ),
              reason:
                row.reason,
              createdAt:
                Number(
                  row.created_at
                ),
              deliveredAt:
                row.delivered_at ===
                null
                  ? undefined
                  : Number(
                      row.delivered_at
                    )
            })
          );
        },

      hasRequest:
        requestId =>
          this.hasRequest(
            requestId
          ),

      markDelivered:
        id =>
          this.markDelivered(id)
    };
  }

  receiptView():
    EventReceiptStore {
    return {
      has:
        eventId =>
          this.has(eventId),

      record:
        eventId =>
          this.record(eventId)
    };
  }
}
