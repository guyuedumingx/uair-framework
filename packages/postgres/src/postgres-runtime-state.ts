import type {
  Execution
} from "@uair/core";

import type {
  EventReceiptStore,
  ExternalEvent,
  InboxRecord,
  InboxStore,
  OutboxRecord,
  OutboxStore,
  Storage,
  SuspensionCreated
} from "@uair/core/runtime";

import {
  StorageConflictError
} from "@uair/core/runtime";

import type {
  PgQueryResult,
  PgQueryable
} from "./index.js";

export interface PgClientLike
  extends PgQueryable {
  release?(): void;
}

export interface PgPoolLike
  extends PgQueryable {
  connect():
    Promise<PgClientLike>;
}

export const POSTGRES_RUNTIME_SCHEMA_VERSION =
  1;

export class PostgresRuntimeSchemaTooNewError
  extends Error {
  constructor(
    readonly found: number,
    readonly supported:
      number
  ) {
    super(
      `PostgreSQL Runtime schema ${found} is newer than supported schema ${supported}.`
    );

    this.name =
      "PostgresRuntimeSchemaTooNewError";
  }
}

export const POSTGRES_RUNTIME_SCHEMA = `
CREATE TABLE IF NOT EXISTS uair_runtime_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uair_executions (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  workflow_version TEXT,
  deployment_id TEXT,
  workflow_fingerprint TEXT,
  history_schema_version INTEGER,
  input_json JSONB,
  status TEXT NOT NULL,
  history_json JSONB NOT NULL,
  result_json JSONB,
  error_json JSONB,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS uair_suspensions (
  suspension_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL
    REFERENCES uair_executions(id)
    ON DELETE CASCADE,
  path TEXT NOT NULL,
  component TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  spec_json JSONB,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  result_valid_for_ms BIGINT
);

CREATE INDEX IF NOT EXISTS idx_uair_suspensions_execution
ON uair_suspensions(execution_id);

CREATE INDEX IF NOT EXISTS idx_uair_suspensions_timer
ON uair_suspensions(expires_at);

CREATE TABLE IF NOT EXISTS uair_inbox (
  event_id TEXT PRIMARY KEY,
  event_json JSONB NOT NULL,
  received_at BIGINT NOT NULL,
  consumed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_uair_inbox_pending
ON uair_inbox(consumed_at);

CREATE TABLE IF NOT EXISTS uair_event_receipts (
  event_id TEXT PRIMARY KEY,
  processed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS uair_outbox (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  execution_id TEXT NOT NULL
    REFERENCES uair_executions(id)
    ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  delivered_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_uair_outbox_pending
ON uair_outbox(delivered_at);
`;

function jsonValue<T>(
  value: unknown
): T | undefined {
  if (
    value === null ||
    value === undefined
  ) {
    return undefined;
  }

  if (
    typeof value ===
      "string"
  ) {
    return JSON.parse(
      value
    ) as T;
  }

  return value as T;
}

function decodeExecution(
  row: any
): Execution {
  return {
    id:
      String(
        row.id
      ),
    workflow:
      String(
        row.workflow
      ),
    workflowVersion:
      row.workflow_version ==
        null
        ? undefined
        : String(
            row.workflow_version
          ),
    deploymentId:
      row.deployment_id ==
        null
        ? undefined
        : String(
            row.deployment_id
          ),
    workflowFingerprint:
      row.workflow_fingerprint ==
        null
        ? undefined
        : String(
            row.workflow_fingerprint
          ),
    historySchemaVersion:
      row.history_schema_version ==
        null
        ? undefined
        : Number(
            row.history_schema_version
          ),
    input:
      jsonValue(
        row.input_json
      ),
    status:
      row.status,
    history:
      jsonValue(
        row.history_json
      ) ??
      [],
    result:
      jsonValue(
        row.result_json
      ),
    error:
      jsonValue(
        row.error_json
      ),
    revision:
      Number(
        row.revision
      )
  };
}

function decodeSuspension(
  row: any
): SuspensionCreated {
  return {
    kind:
      "suspension_created",
    path:
      String(
        row.path
      ),
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
      row.expires_at ==
        null
        ? undefined
        : Number(
            row.expires_at
          ),
    resultValidForMs:
      row.result_valid_for_ms ==
        null
        ? undefined
        : Number(
            row.result_valid_for_ms
          ),
    spec:
      jsonValue(
        row.spec_json
      )
  };
}

export class PostgresRuntimeState
  implements
    Storage,
    EventReceiptStore {
  constructor(
    readonly db:
      PgPoolLike
  ) {}

  async migrate() {
    await this.db.query(
      POSTGRES_RUNTIME_SCHEMA
    );

    const result =
      await this.db.query<{
        value: string;
      }>(`
        SELECT value
        FROM uair_runtime_meta
        WHERE key = 'runtime_schema_version'
      `);

    const found =
      result.rows[0]
        ? Number(
            result.rows[0]
              .value
          )
        : 0;

    if (
      found >
      POSTGRES_RUNTIME_SCHEMA_VERSION
    ) {
      throw new PostgresRuntimeSchemaTooNewError(
        found,
        POSTGRES_RUNTIME_SCHEMA_VERSION
      );
    }

    await this.db.query(`
      INSERT INTO uair_runtime_meta (
        key,
        value
      )
      VALUES (
        'runtime_schema_version',
        $1
      )
      ON CONFLICT(key)
      DO UPDATE SET value = EXCLUDED.value
    `, [
      String(
        POSTGRES_RUNTIME_SCHEMA_VERSION
      )
    ]);
  }

  private async transaction<T>(
    fn: (
      client:
        PgClientLike
    ) =>
      Promise<T>
  ) {
    const client =
      await this.db.connect();

    await client.query(
      "BEGIN"
    );

    try {
      const value =
        await fn(
          client
        );

      await client.query(
        "COMMIT"
      );

      return value;
    } catch (
      error
    ) {
      await client.query(
        "ROLLBACK"
      );

      throw error;
    } finally {
      client.release?.();
    }
  }

  private async upsertExecution(
    db:
      PgQueryable,
    execution:
      Execution,
    expectedRevision?:
      number
  ) {
    /**
     * One SQL statement is the optimistic concurrency fence.
     *
     * This is important for the "row does not exist yet" race: a
     * SELECT ... FOR UPDATE cannot lock a missing row, while
     * INSERT ... ON CONFLICT ... WHERE revision = expected can still
     * produce exactly one winner.
     */
    const result =
      await db.query<{
        revision:
          string |
          number;
      }>(`
        INSERT INTO uair_executions (
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
        VALUES (
          $1,$2,$3,$4,$5,$6,
          $7::jsonb,$8,$9::jsonb,
          $10::jsonb,$11::jsonb,
          1,$12
        )
        ON CONFLICT(id)
        DO UPDATE SET
          workflow = EXCLUDED.workflow,
          workflow_version = EXCLUDED.workflow_version,
          deployment_id = EXCLUDED.deployment_id,
          workflow_fingerprint = EXCLUDED.workflow_fingerprint,
          history_schema_version = EXCLUDED.history_schema_version,
          input_json = EXCLUDED.input_json,
          status = EXCLUDED.status,
          history_json = EXCLUDED.history_json,
          result_json = EXCLUDED.result_json,
          error_json = EXCLUDED.error_json,
          revision =
            uair_executions.revision + 1,
          updated_at = EXCLUDED.updated_at
        WHERE
          $13::bigint IS NULL
          OR uair_executions.revision =
            $13::bigint
        RETURNING revision
      `, [
        execution.id,
        execution.workflow,
        execution
          .workflowVersion ??
          null,
        execution
          .deploymentId ??
          null,
        execution
          .workflowFingerprint ??
          null,
        execution
          .historySchemaVersion ??
          null,
        JSON.stringify(
          execution.input ??
          null
        ),
        execution.status,
        JSON.stringify(
          execution.history
        ),
        JSON.stringify(
          execution.result ??
          null
        ),
        JSON.stringify(
          execution.error ??
          null
        ),
        Date.now(),
        expectedRevision ??
          null
      ]);

    const row =
      result.rows[0];

    if (!row) {
      const current =
        await db.query<{
          revision:
            string |
            number;
        }>(`
          SELECT revision
          FROM uair_executions
          WHERE id = $1
        `, [
          execution.id
        ]);

      throw new StorageConflictError(
        `Execution ${execution.id} revision conflict. ` +
        `Expected ${expectedRevision}, found ` +
        `${current.rows[0] ? Number(current.rows[0].revision) : 0}.`
      );
    }

    execution.revision =
      Number(
        row.revision
      );
  }

  async loadExecution(
    id: string
  ) {
    const result =
      await this.db.query(`
        SELECT *
        FROM uair_executions
        WHERE id = $1
      `, [
        id
      ]);

    return result.rows[0]
      ? decodeExecution(
          result.rows[0]
        )
      : null;
  }

  async saveExecution(
    execution:
      Execution,
    expectedRevision?:
      number
  ) {
    await this.transaction(
      client =>
        this.upsertExecution(
          client,
          execution,
          expectedRevision
        )
    );
  }

  async listExecutions() {
    const result =
      await this.db.query(`
        SELECT *
        FROM uair_executions
        ORDER BY updated_at, id
      `);

    return result.rows.map(
      decodeExecution
    );
  }

  async findSuspension(
    suspensionId: string
  ) {
    const result =
      await this.db.query(`
        SELECT *
        FROM uair_suspensions
        WHERE suspension_id = $1
      `, [
        suspensionId
      ]);

    const row =
      result.rows[0];

    return row
      ? {
          executionId:
            String(
              row.execution_id
            ),
          suspension:
            decodeSuspension(
              row
            )
        }
      : null;
  }

  async indexSuspension(
    executionId: string,
    suspension:
      SuspensionCreated
  ) {
    await this.db.query(`
      INSERT INTO uair_suspensions (
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
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7::jsonb,$8,$9,$10
      )
      ON CONFLICT(suspension_id)
      DO UPDATE SET
        execution_id = EXCLUDED.execution_id,
        path = EXCLUDED.path,
        component = EXCLUDED.component,
        effect_id = EXCLUDED.effect_id,
        generation = EXCLUDED.generation,
        spec_json = EXCLUDED.spec_json,
        created_at = EXCLUDED.created_at,
        expires_at = EXCLUDED.expires_at,
        result_valid_for_ms = EXCLUDED.result_valid_for_ms
    `, [
      suspension.suspensionId,
      executionId,
      suspension.path,
      suspension.component,
      suspension.effectId,
      suspension.generation,
      JSON.stringify(
        suspension.spec ??
        null
      ),
      suspension.createdAt,
      suspension.expiresAt ??
        null,
      suspension.resultValidForMs ??
        null
    ]);
  }

  async removeSuspensionIndex(
    suspensionId: string
  ) {
    await this.db.query(`
      DELETE FROM uair_suspensions
      WHERE suspension_id = $1
    `, [
      suspensionId
    ]);
  }

  async listSuspensions() {
    const result =
      await this.db.query(`
        SELECT *
        FROM uair_suspensions
        ORDER BY created_at, suspension_id
      `);

    return result.rows.map(
      row => ({
        executionId:
          String(
            row.execution_id
          ),
        suspension:
          decodeSuspension(
            row
          )
      })
    );
  }

  async saveExecutionAndIndexSuspension(
    execution:
      Execution,
    suspension:
      SuspensionCreated,
    expectedRevision?:
      number
  ) {
    await this.transaction(
      async client => {
        await this.upsertExecution(
          client,
          execution,
          expectedRevision
        );

        await client.query(`
          INSERT INTO uair_suspensions (
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
          VALUES (
            $1,$2,$3,$4,$5,$6,
            $7::jsonb,$8,$9,$10
          )
          ON CONFLICT(suspension_id)
          DO UPDATE SET
            execution_id = EXCLUDED.execution_id,
            path = EXCLUDED.path,
            component = EXCLUDED.component,
            effect_id = EXCLUDED.effect_id,
            generation = EXCLUDED.generation,
            spec_json = EXCLUDED.spec_json,
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at,
            result_valid_for_ms = EXCLUDED.result_valid_for_ms
        `, [
          suspension.suspensionId,
          execution.id,
          suspension.path,
          suspension.component,
          suspension.effectId,
          suspension.generation,
          JSON.stringify(
            suspension.spec ??
            null
          ),
          suspension.createdAt,
          suspension.expiresAt ??
            null,
          suspension.resultValidForMs ??
            null
        ]);
      }
    );
  }

  async saveExecutionAndRemoveSuspension(
    execution:
      Execution,
    suspensionId: string,
    expectedRevision?:
      number
  ) {
    await this.transaction(
      async client => {
        await this.upsertExecution(
          client,
          execution,
          expectedRevision
        );

        await client.query(`
          DELETE FROM uair_suspensions
          WHERE suspension_id = $1
        `, [
          suspensionId
        ]);
      }
    );
  }

  async put(
    event:
      ExternalEvent
  ) {
    await this.db.query(`
      INSERT INTO uair_inbox (
        event_id,
        event_json,
        received_at
      )
      VALUES (
        $1,$2::jsonb,$3
      )
      ON CONFLICT(event_id)
      DO NOTHING
    `, [
      event.id,
      JSON.stringify(
        event
      ),
      Date.now()
    ]);
  }

  async listInboxPending():
    Promise<
      InboxRecord[]
    > {
    const result =
      await this.db.query(`
        SELECT *
        FROM uair_inbox
        WHERE consumed_at IS NULL
        ORDER BY received_at, event_id
      `);

    return result.rows.map(
      row => ({
        event:
          jsonValue(
            row.event_json
          )!,
        receivedAt:
          Number(
            row.received_at
          ),
        consumedAt:
          row.consumed_at ==
            null
            ? undefined
            : Number(
                row.consumed_at
              )
      })
    );
  }

  async markConsumed(
    eventId: string
  ) {
    await this.db.query(`
      UPDATE uair_inbox
      SET consumed_at = COALESCE(
        consumed_at,
        $1
      )
      WHERE event_id = $2
    `, [
      Date.now(),
      eventId
    ]);
  }

  async has(
    eventId: string
  ) {
    const result =
      await this.db.query(`
        SELECT 1
        FROM uair_event_receipts
        WHERE event_id = $1
      `, [
        eventId
      ]);

    return Boolean(
      result.rows[0]
    );
  }

  async record(
    eventId: string
  ) {
    await this.db.query(`
      INSERT INTO uair_event_receipts (
        event_id,
        processed_at
      )
      VALUES ($1,$2)
      ON CONFLICT(event_id)
      DO NOTHING
    `, [
      eventId,
      Date.now()
    ]);
  }

  async ensure(
    requestId: string,
    executionId: string,
    reason:
      | "event"
      | "timer"
      | "manual"
      | "recovery"
  ): Promise<
    OutboxRecord
  > {
    const id =
      `out_${requestId}`;

    const now =
      Date.now();

    const result =
      await this.db.query(`
        INSERT INTO uair_outbox (
          id,
          request_id,
          execution_id,
          reason,
          created_at
        )
        VALUES (
          $1,$2,$3,$4,$5
        )
        ON CONFLICT(request_id)
        DO UPDATE SET
          request_id =
            EXCLUDED.request_id
        RETURNING *
      `, [
      id,
      requestId,
      executionId,
      reason,
      now
    ]);

    const row =
      result.rows[0];

    return {
      id:
        String(
          row.id
        ),
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
        row.delivered_at ==
          null
          ? undefined
          : Number(
              row.delivered_at
            )
    };
  }

  async listOutboxPending():
    Promise<
      OutboxRecord[]
    > {
    const result =
      await this.db.query(`
        SELECT *
        FROM uair_outbox
        WHERE delivered_at IS NULL
        ORDER BY created_at, id
      `);

    return result.rows.map(
      row => ({
        id:
          String(
            row.id
          ),
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
          row.delivered_at ==
            null
            ? undefined
            : Number(
                row.delivered_at
              )
      })
    );
  }

  async hasRequest(
    requestId: string
  ) {
    const result =
      await this.db.query(`
        SELECT 1
        FROM uair_outbox
        WHERE request_id = $1
      `, [
        requestId
      ]);

    return Boolean(
      result.rows[0]
    );
  }

  async markDelivered(
    id: string
  ) {
    await this.db.query(`
      UPDATE uair_outbox
      SET delivered_at =
        COALESCE(
          delivered_at,
          $1
        )
      WHERE id = $2
    `, [
      Date.now(),
      id
    ]);
  }
  inboxView(): InboxStore {
    return {
      put:
        event =>
          this.put(event),

      listPending:
        () =>
          this.listInboxPending(),

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
        () =>
          this.listOutboxPending(),

      hasRequest:
        requestId =>
          this.hasRequest(
            requestId
          ),

      markDelivered:
        id =>
          this.markDelivered(
            id
          )
    };
  }

  receiptView():
    EventReceiptStore {
    return {
      has:
        eventId =>
          this.has(
            eventId
          ),

      record:
        eventId =>
          this.record(
            eventId
          )
    };
  }

}
