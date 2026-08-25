import {
  McpInvocationConflictError,
  McpInvocationLeaseLostError,
  internalAssertCompatibleRequest,
  internalAssertLeaseDuration,
  internalClaimRecord,
  internalRenewRecord,
  type McpInvocationClaimOptions,
  type McpInvocationClaimResult,
  type McpInvocationIdentity,
  type McpInvocationRecord,
  type McpInvocationStore
} from "./invocation-store.js";

export const POSTGRES_MCP_INVOCATION_SCHEMA_VERSION =
  1;

export type PostgresMcpQueryResult<Row = any> = {
  rows: Row[];
  rowCount?: number | null;
};

export interface PostgresMcpInvocationClient {
  query<Row = any>(
    text: string,
    values?: unknown[]
  ): Promise<PostgresMcpQueryResult<Row>>;
  release?(): void;
}

export interface PostgresMcpInvocationPool {
  connect(): Promise<PostgresMcpInvocationClient>;
}

export class PostgresMcpInvocationSchemaTooNewError
extends Error {
  constructor(
    readonly found: number,
    readonly supported: number
  ) {
    super(
      `PostgreSQL MCP invocation schema ${found} is newer than supported schema ${supported}.`
    );
    this.name =
      "PostgresMcpInvocationSchemaTooNewError";
  }
}

type PostgresInvocationRow = {
  principal_key: string;
  tool_name: string;
  idempotency_key: string;
  access_scope_key: string;
  request_hash: string;
  status: "claimed" | "bound" | "complete";
  execution_id: string | null;
  lease_token: string;
  lease_expires_at: string | number;
  created_at: string | number;
  updated_at: string | number;
};

function decodeRow(
  row: PostgresInvocationRow | undefined
): McpInvocationRecord | null {
  if (!row) {
    return null;
  }
  return {
    principalKey: String(row.principal_key),
    toolName: String(row.tool_name),
    idempotencyKey: String(row.idempotency_key),
    accessScopeKey: String(row.access_scope_key),
    requestHash: String(row.request_hash),
    status: row.status,
    ...(row.execution_id === null
      ? {}
      : {
          executionId: String(row.execution_id)
        }),
    leaseToken: String(row.lease_token),
    leaseExpiresAt: Number(row.lease_expires_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function isPostgresUniqueConstraint(
  error: unknown
) {
  return (
    error as { code?: unknown }
  )?.code === "23505";
}

export class PostgresMcpInvocationStore
implements McpInvocationStore {
  constructor(
    private readonly pool:
      PostgresMcpInvocationPool
  ) {}

  async migrate() {
    await this.transaction(async client => {
      await client.query(`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            'uair_mcp_invocation_schema',
            0
          )
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS uair_mcp_invocation_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      const version = await client.query<{
        value: string;
      }>(`
        SELECT value
        FROM uair_mcp_invocation_meta
        WHERE key = 'schema_version'
        FOR UPDATE
      `);
      const found = version.rows[0]
        ? Number(version.rows[0].value)
        : 0;
      if (
        !Number.isSafeInteger(found) ||
        found < 0
      ) {
        throw new Error(
          "PostgreSQL MCP invocation schema version is invalid"
        );
      }
      if (
        found >
        POSTGRES_MCP_INVOCATION_SCHEMA_VERSION
      ) {
        throw new PostgresMcpInvocationSchemaTooNewError(
          found,
          POSTGRES_MCP_INVOCATION_SCHEMA_VERSION
        );
      }

      await client.query(`
        CREATE TABLE IF NOT EXISTS uair_mcp_invocations (
          principal_key TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          access_scope_key TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('claimed', 'bound', 'complete')
          ),
          execution_id TEXT UNIQUE,
          lease_token TEXT NOT NULL,
          lease_expires_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (
            principal_key,
            tool_name,
            idempotency_key
          ),
          CHECK (
            (status = 'claimed' AND execution_id IS NULL)
            OR
            (status IN ('bound', 'complete') AND execution_id IS NOT NULL)
          )
        );

        CREATE INDEX IF NOT EXISTS idx_uair_mcp_invocations_execution
        ON uair_mcp_invocations(execution_id);

        CREATE INDEX IF NOT EXISTS idx_uair_mcp_invocations_lease
        ON uair_mcp_invocations(status, lease_expires_at);
      `);
      await client.query(`
        INSERT INTO uair_mcp_invocation_meta (key, value)
        VALUES ('schema_version', $1)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `, [
        String(
          POSTGRES_MCP_INVOCATION_SCHEMA_VERSION
        )
      ]);
    });
  }

  async find(
    identity: McpInvocationIdentity
  ) {
    return this.withClient(async client =>
      this.selectIdentity(
        client,
        identity,
        false
      )
    );
  }

  async findByExecutionId(
    executionId: string
  ) {
    return this.withClient(async client => {
      const result =
        await client.query<PostgresInvocationRow>(`
          SELECT *
          FROM uair_mcp_invocations
          WHERE execution_id = $1
        `, [executionId]);
      return decodeRow(result.rows[0]);
    });
  }

  async claim(
    identity: McpInvocationIdentity,
    options: McpInvocationClaimOptions
  ): Promise<McpInvocationClaimResult> {
    internalAssertLeaseDuration(
      options.leaseDurationMs
    );

    return this.transaction(async client => {
      const candidate = internalClaimRecord(
        identity,
        options
      );
      const inserted =
        await client.query<PostgresInvocationRow>(`
          INSERT INTO uair_mcp_invocations (
            principal_key,
            tool_name,
            idempotency_key,
            access_scope_key,
            request_hash,
            status,
            execution_id,
            lease_token,
            lease_expires_at,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            'claimed', NULL, $6, $7, $8, $8
          )
          ON CONFLICT DO NOTHING
          RETURNING *
        `, [
          identity.principalKey,
          identity.toolName,
          identity.idempotencyKey,
          options.accessScopeKey,
          options.requestHash,
          candidate.leaseToken,
          candidate.leaseExpiresAt,
          candidate.createdAt
        ]);
      const insertedRecord =
        decodeRow(inserted.rows[0]);
      if (insertedRecord) {
        return {
          acquired: true,
          leaseToken:
            insertedRecord.leaseToken,
          record: insertedRecord
        };
      }

      const existing =
        await this.selectIdentity(
          client,
          identity,
          true
        );
      if (!existing) {
        throw new Error(
          "MCP invocation disappeared during claim"
        );
      }
      internalAssertCompatibleRequest(
        existing,
        options
      );
      if (
        existing.status === "complete" ||
        existing.leaseExpiresAt >
          options.now
      ) {
        return {
          acquired: false,
          record: existing
        };
      }

      const record = internalClaimRecord(
        identity,
        options,
        existing
      );
      await this.writeRecord(
        client,
        record,
        existing.leaseToken
      );
      return {
        acquired: true,
        leaseToken: record.leaseToken,
        record
      };
    });
  }

  async renew(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number,
    leaseDurationMs: number
  ) {
    internalAssertLeaseDuration(
      leaseDurationMs
    );
    return this.updateLease(
      identity,
      leaseToken,
      current =>
        internalRenewRecord(
          current,
          now,
          leaseDurationMs
        )
    );
  }

  async bindExecution(
    identity: McpInvocationIdentity,
    leaseToken: string,
    executionId: string,
    now: number,
    leaseDurationMs: number
  ) {
    internalAssertLeaseDuration(
      leaseDurationMs
    );
    try {
      return await this.updateLease(
        identity,
        leaseToken,
        current =>
          internalRenewRecord(
            {
              ...current,
              status: "bound",
              executionId
            },
            now,
            leaseDurationMs
          )
      );
    } catch (error) {
      if (isPostgresUniqueConstraint(error)) {
        throw new McpInvocationConflictError(
          "MCP Execution is already bound to another invocation"
        );
      }
      throw error;
    }
  }

  async complete(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number
  ) {
    return this.updateLease(
      identity,
      leaseToken,
      current => {
        if (!current.executionId) {
          throw new McpInvocationConflictError(
            "MCP invocation cannot complete before an Execution is bound"
          );
        }
        return {
          ...current,
          status: "complete",
          leaseExpiresAt: now,
          updatedAt: now
        };
      }
    );
  }

  async release(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number
  ) {
    return this.updateLease(
      identity,
      leaseToken,
      current => ({
        ...current,
        status: current.executionId
          ? "bound"
          : "claimed",
        leaseExpiresAt: now,
        updatedAt: now
      })
    );
  }

  private async updateLease(
    identity: McpInvocationIdentity,
    leaseToken: string,
    update:
      (
        current: McpInvocationRecord
      ) => McpInvocationRecord
  ) {
    return this.transaction(async client => {
      const current =
        await this.selectIdentity(
          client,
          identity,
          true
        );
      if (
        !current ||
        current.leaseToken !== leaseToken ||
        current.status === "complete"
      ) {
        throw new McpInvocationLeaseLostError();
      }
      const next = update(current);
      await this.writeRecord(
        client,
        next,
        leaseToken
      );
      return next;
    });
  }

  private async selectIdentity(
    client: PostgresMcpInvocationClient,
    identity: McpInvocationIdentity,
    forUpdate: boolean
  ) {
    const result =
      await client.query<PostgresInvocationRow>(`
        SELECT *
        FROM uair_mcp_invocations
        WHERE principal_key = $1
          AND tool_name = $2
          AND idempotency_key = $3
        ${forUpdate ? "FOR UPDATE" : ""}
      `, [
        identity.principalKey,
        identity.toolName,
        identity.idempotencyKey
      ]);
    return decodeRow(result.rows[0]);
  }

  private async writeRecord(
    client: PostgresMcpInvocationClient,
    record: McpInvocationRecord,
    expectedLeaseToken: string
  ) {
    const result = await client.query(`
      UPDATE uair_mcp_invocations
      SET status = $1,
          execution_id = $2,
          lease_token = $3,
          lease_expires_at = $4,
          updated_at = $5
      WHERE principal_key = $6
        AND tool_name = $7
        AND idempotency_key = $8
        AND lease_token = $9
        AND status <> 'complete'
    `, [
      record.status,
      record.executionId ?? null,
      record.leaseToken,
      record.leaseExpiresAt,
      record.updatedAt,
      record.principalKey,
      record.toolName,
      record.idempotencyKey,
      expectedLeaseToken
    ]);
    if (result.rowCount !== 1) {
      throw new McpInvocationLeaseLostError();
    }
  }

  private async withClient<T>(
    operation:
      (
        client: PostgresMcpInvocationClient
      ) => Promise<T>
  ) {
    const client = await this.pool.connect();
    try {
      return await operation(client);
    } finally {
      client.release?.();
    }
  }

  private async transaction<T>(
    operation:
      (
        client: PostgresMcpInvocationClient
      ) => Promise<T>
  ) {
    return this.withClient(async client => {
      await client.query("BEGIN");
      try {
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      }
    });
  }
}
