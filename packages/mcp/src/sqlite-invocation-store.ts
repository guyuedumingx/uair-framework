import {
  mkdirSync
} from "node:fs";
import {
  dirname
} from "node:path";
import {
  DatabaseSync
} from "node:sqlite";

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

export const SQLITE_MCP_INVOCATION_SCHEMA_VERSION =
  1;

export class SqliteMcpInvocationSchemaTooNewError
extends Error {
  constructor(
    readonly found: number,
    readonly supported: number
  ) {
    super(
      `SQLite MCP invocation schema ${found} is newer than supported schema ${supported}.`
    );
    this.name =
      "SqliteMcpInvocationSchemaTooNewError";
  }
}

type SqliteInvocationRow = {
  principal_key: string;
  tool_name: string;
  idempotency_key: string;
  access_scope_key: string;
  request_hash: string;
  status: "claimed" | "bound" | "complete";
  execution_id: string | null;
  lease_token: string;
  lease_expires_at: number;
  created_at: number;
  updated_at: number;
};

function decodeRow(
  row: SqliteInvocationRow | undefined
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

function isSqliteUniqueConstraint(
  error: unknown
) {
  const candidate = error as {
    errcode?: unknown;
    message?: unknown;
  };
  return candidate.errcode === 2067 &&
    typeof candidate.message === "string" &&
    candidate.message.includes(
      "uair_mcp_invocations.execution_id"
    );
}

export class SqliteMcpInvocationStore
implements McpInvocationStore {
  readonly db: DatabaseSync;

  constructor(
    readonly file =
      ".uair/uair.sqlite"
  ) {
    mkdirSync(dirname(file), {
      recursive: true
    });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
    `);
  }

  async migrate() {
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS uair_mcp_invocation_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      const version = this.db.prepare(`
        SELECT value
        FROM uair_mcp_invocation_meta
        WHERE key = 'schema_version'
      `).get() as
        | { value: string }
        | undefined;
      const found = version
        ? Number(version.value)
        : 0;

      if (
        !Number.isSafeInteger(found) ||
        found < 0
      ) {
        throw new Error(
          "SQLite MCP invocation schema version is invalid"
        );
      }

      if (
        found >
        SQLITE_MCP_INVOCATION_SCHEMA_VERSION
      ) {
        throw new SqliteMcpInvocationSchemaTooNewError(
          found,
          SQLITE_MCP_INVOCATION_SCHEMA_VERSION
        );
      }

      this.db.exec(`
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
          lease_expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
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
      this.db.prepare(`
        INSERT INTO uair_mcp_invocation_meta (key, value)
        VALUES ('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(
        String(
          SQLITE_MCP_INVOCATION_SCHEMA_VERSION
        )
      );
    });
  }

  close() {
    this.db.close();
  }

  async find(
    identity: McpInvocationIdentity
  ) {
    return this.selectIdentity(identity);
  }

  async findByExecutionId(
    executionId: string
  ) {
    return decodeRow(
      this.db.prepare(`
        SELECT *
        FROM uair_mcp_invocations
        WHERE execution_id = ?
      `).get(executionId) as
        | SqliteInvocationRow
        | undefined
    );
  }

  async claim(
    identity: McpInvocationIdentity,
    options: McpInvocationClaimOptions
  ): Promise<McpInvocationClaimResult> {
    internalAssertLeaseDuration(
      options.leaseDurationMs
    );

    return this.transaction(() => {
      const existing =
        this.selectIdentity(identity);

      if (existing) {
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
      }

      const record = internalClaimRecord(
        identity,
        options,
        existing ?? undefined
      );

      this.db.prepare(`
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(
          principal_key,
          tool_name,
          idempotency_key
        ) DO UPDATE SET
          status = excluded.status,
          lease_token = excluded.lease_token,
          lease_expires_at = excluded.lease_expires_at,
          updated_at = excluded.updated_at
      `).run(
        record.principalKey,
        record.toolName,
        record.idempotencyKey,
        record.accessScopeKey,
        record.requestHash,
        record.status,
        record.executionId ?? null,
        record.leaseToken,
        record.leaseExpiresAt,
        record.createdAt,
        record.updatedAt
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
      return this.updateLease(
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
      if (isSqliteUniqueConstraint(error)) {
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

  private selectIdentity(
    identity: McpInvocationIdentity
  ) {
    return decodeRow(
      this.db.prepare(`
        SELECT *
        FROM uair_mcp_invocations
        WHERE principal_key = ?
          AND tool_name = ?
          AND idempotency_key = ?
      `).get(
        identity.principalKey,
        identity.toolName,
        identity.idempotencyKey
      ) as
        | SqliteInvocationRow
        | undefined
    );
  }

  private updateLease(
    identity: McpInvocationIdentity,
    leaseToken: string,
    update:
      (
        current: McpInvocationRecord
      ) => McpInvocationRecord
  ) {
    return this.transaction(() => {
      const current =
        this.selectIdentity(identity);
      if (
        !current ||
        current.leaseToken !== leaseToken ||
        current.status === "complete"
      ) {
        throw new McpInvocationLeaseLostError();
      }
      const next = update(current);
      const result = this.db.prepare(`
        UPDATE uair_mcp_invocations
        SET status = ?,
            execution_id = ?,
            lease_token = ?,
            lease_expires_at = ?,
            updated_at = ?
        WHERE principal_key = ?
          AND tool_name = ?
          AND idempotency_key = ?
          AND lease_token = ?
          AND status <> 'complete'
      `).run(
        next.status,
        next.executionId ?? null,
        next.leaseToken,
        next.leaseExpiresAt,
        next.updatedAt,
        identity.principalKey,
        identity.toolName,
        identity.idempotencyKey,
        leaseToken
      );
      if (result.changes !== 1) {
        throw new McpInvocationLeaseLostError();
      }
      return next;
    });
  }

  private transaction<T>(
    operation: () => T
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
}
