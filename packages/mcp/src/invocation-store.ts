import {
  createHash,
  randomUUID
} from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import {
  join
} from "node:path";

export type McpInvocationIdentity = {
  principalKey: string;
  toolName: string;
  idempotencyKey: string;
};

export type McpInvocationStatus =
  | "claimed"
  | "bound"
  | "complete";

export type McpInvocationRecord =
  McpInvocationIdentity & {
    accessScopeKey: string;
    requestHash: string;
    status: McpInvocationStatus;
    executionId?: string;
    leaseToken: string;
    leaseExpiresAt: number;
    createdAt: number;
    updatedAt: number;
  };

export type McpInvocationClaimOptions = {
  accessScopeKey: string;
  requestHash: string;
  now: number;
  leaseDurationMs: number;
};

export type McpInvocationClaimResult =
  | {
      acquired: true;
      leaseToken: string;
      record: McpInvocationRecord;
    }
  | {
      acquired: false;
      record: McpInvocationRecord;
    };

export interface McpInvocationStore {
  find(
    identity: McpInvocationIdentity
  ): Promise<McpInvocationRecord | null>;

  findByExecutionId(
    executionId: string
  ): Promise<McpInvocationRecord | null>;

  claim(
    identity: McpInvocationIdentity,
    options: McpInvocationClaimOptions
  ): Promise<McpInvocationClaimResult>;

  renew(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number,
    leaseDurationMs: number
  ): Promise<McpInvocationRecord>;

  bindExecution(
    identity: McpInvocationIdentity,
    leaseToken: string,
    executionId: string,
    now: number,
    leaseDurationMs: number
  ): Promise<McpInvocationRecord>;

  complete(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number
  ): Promise<McpInvocationRecord>;

  release(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number
  ): Promise<McpInvocationRecord>;
}

export class McpInvocationConflictError
extends Error {
  constructor(
    message: string
  ) {
    super(message);
    this.name = "McpInvocationConflictError";
  }
}

export class McpInvocationLeaseLostError
extends Error {
  constructor() {
    super("MCP invocation claim lease was lost");
    this.name = "McpInvocationLeaseLostError";
  }
}

export class McpInvocationStoreCorruptError
extends Error {
  constructor(
    path: string,
    cause?: unknown
  ) {
    super(
      `MCP invocation record is corrupt: ${path}`,
      { cause }
    );
    this.name = "McpInvocationStoreCorruptError";
  }
}

function identityKey(
  identity: McpInvocationIdentity
) {
  return JSON.stringify([
    identity.principalKey,
    identity.toolName,
    identity.idempotencyKey
  ]);
}

function assertLeaseDuration(
  leaseDurationMs: number
) {
  if (
    !Number.isFinite(leaseDurationMs) ||
    leaseDurationMs <= 0
  ) {
    throw new Error(
      "MCP invocation lease duration must be a positive finite number"
    );
  }
}

function claimRecord(
  identity: McpInvocationIdentity,
  options: McpInvocationClaimOptions,
  existing?: McpInvocationRecord
): McpInvocationRecord {
  assertLeaseDuration(
    options.leaseDurationMs
  );

  const leaseToken = randomUUID();

  return {
    ...identity,
    accessScopeKey:
      options.accessScopeKey,
    requestHash:
      options.requestHash,
    status:
      existing?.executionId
        ? "bound"
        : "claimed",
    ...(existing?.executionId
      ? {
          executionId:
            existing.executionId
        }
      : {}),
    leaseToken,
    leaseExpiresAt:
      options.now +
      options.leaseDurationMs,
    createdAt:
      existing?.createdAt ??
      options.now,
    updatedAt:
      options.now
  };
}

function assertCompatibleRequest(
  existing: McpInvocationRecord,
  options: McpInvocationClaimOptions
) {
  if (
    existing.requestHash !==
      options.requestHash
  ) {
    throw new McpInvocationConflictError(
      "MCP idempotency key was already used with different input"
    );
  }

  if (
    existing.accessScopeKey !==
      options.accessScopeKey
  ) {
    throw new McpInvocationConflictError(
      "MCP idempotency key access scope changed"
    );
  }
}

function assertLease(
  record: McpInvocationRecord | null,
  leaseToken: string
): asserts record is McpInvocationRecord {
  if (
    !record ||
    record.leaseToken !==
      leaseToken ||
    record.status ===
      "complete"
  ) {
    throw new McpInvocationLeaseLostError();
  }
}

function renewRecord(
  record: McpInvocationRecord,
  now: number,
  leaseDurationMs: number
) {
  assertLeaseDuration(
    leaseDurationMs
  );

  return {
    ...record,
    leaseExpiresAt:
      now + leaseDurationMs,
    updatedAt: now
  };
}

export class InMemoryMcpInvocationStore
implements McpInvocationStore {
  private readonly records =
    new Map<string, McpInvocationRecord>();

  async find(
    identity: McpInvocationIdentity
  ) {
    return this.records.get(
      identityKey(identity)
    ) ?? null;
  }

  async findByExecutionId(
    executionId: string
  ) {
    return Array.from(
      this.records.values()
    ).find(
      record =>
        record.executionId ===
          executionId
    ) ?? null;
  }

  async claim(
    identity: McpInvocationIdentity,
    options: McpInvocationClaimOptions
  ): Promise<McpInvocationClaimResult> {
    const key = identityKey(identity);
    const existing = this.records.get(key);

    if (existing) {
      assertCompatibleRequest(
        existing,
        options
      );

      if (
        existing.status ===
          "complete" ||
        existing.leaseExpiresAt >
          options.now
      ) {
        return {
          acquired: false,
          record: existing
        };
      }
    }

    const record = claimRecord(
      identity,
      options,
      existing
    );
    this.records.set(key, record);

    return {
      acquired: true,
      leaseToken:
        record.leaseToken,
      record
    };
  }

  async renew(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number,
    leaseDurationMs: number
  ) {
    const key = identityKey(identity);
    const current =
      this.records.get(key) ??
      null;
    assertLease(current, leaseToken);
    const next = renewRecord(
      current,
      now,
      leaseDurationMs
    );
    this.records.set(key, next);
    return next;
  }

  async bindExecution(
    identity: McpInvocationIdentity,
    leaseToken: string,
    executionId: string,
    now: number,
    leaseDurationMs: number
  ) {
    const key = identityKey(identity);
    const current =
      this.records.get(key) ??
      null;
    assertLease(current, leaseToken);
    const next = renewRecord(
      {
        ...current,
        status: "bound",
        executionId
      },
      now,
      leaseDurationMs
    );
    this.records.set(key, next);
    return next;
  }

  async complete(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number
  ) {
    const key = identityKey(identity);
    const current =
      this.records.get(key) ??
      null;
    assertLease(current, leaseToken);

    if (!current.executionId) {
      throw new McpInvocationConflictError(
        "MCP invocation cannot complete before an Execution is bound"
      );
    }

    const next: McpInvocationRecord = {
      ...current,
      status: "complete",
      leaseExpiresAt: now,
      updatedAt: now
    };
    this.records.set(key, next);
    return next;
  }

  async release(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number
  ) {
    const key = identityKey(identity);
    const current =
      this.records.get(key) ??
      null;
    assertLease(current, leaseToken);
    const next: McpInvocationRecord = {
      ...current,
      status:
        current.executionId
          ? "bound"
          : "claimed",
      leaseExpiresAt: now,
      updatedAt: now
    };
    this.records.set(key, next);
    return next;
  }
}

export type JsonFileMcpInvocationStoreOptions = {
  lockRetryMs?: number;
  lockTimeoutMs?: number;
  staleLockMs?: number;
};

export class JsonFileMcpInvocationStore
implements McpInvocationStore {
  private readonly lockRetryMs: number;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(
    private readonly directory: string,
    options:
      JsonFileMcpInvocationStoreOptions =
        {}
  ) {
    this.lockRetryMs =
      options.lockRetryMs ?? 5;
    this.lockTimeoutMs =
      options.lockTimeoutMs ?? 5_000;
    this.staleLockMs =
      options.staleLockMs ?? 60_000;
  }

  async find(
    identity: McpInvocationIdentity
  ) {
    const path = this.pathFor(identity);
    return this.readIdentityRecord(
      path,
      identity
    );
  }

  async findByExecutionId(
    executionId: string
  ) {
    try {
      const names = await readdir(
        this.directory
      );

      for (const name of names) {
        if (!name.endsWith(".json")) {
          continue;
        }

        const record = await this.readRecord(
          join(this.directory, name)
        );

        if (
          record?.executionId ===
            executionId
        ) {
          return record;
        }
      }

      return null;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code ===
          "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }

  async claim(
    identity: McpInvocationIdentity,
    options: McpInvocationClaimOptions
  ): Promise<McpInvocationClaimResult> {
    return this.withLock(
      identity,
      async path => {
        const existing =
          await this.readIdentityRecord(
            path,
            identity
          );

        if (existing) {
          assertCompatibleRequest(
            existing,
            options
          );

          if (
            existing.status ===
              "complete" ||
            existing.leaseExpiresAt >
              options.now
          ) {
            return {
              acquired: false,
              record: existing
            };
          }
        }

        const record = claimRecord(
          identity,
          options,
          existing ?? undefined
        );
        await this.writeRecord(
          path,
          record
        );

        return {
          acquired: true,
          leaseToken:
            record.leaseToken,
          record
        };
      }
    );
  }

  async renew(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number,
    leaseDurationMs: number
  ) {
    return this.updateLease(
      identity,
      leaseToken,
      record =>
        renewRecord(
          record,
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
    return this.updateLease(
      identity,
      leaseToken,
      record =>
        renewRecord(
          {
            ...record,
            status: "bound",
            executionId
          },
          now,
          leaseDurationMs
        )
    );
  }

  async complete(
    identity: McpInvocationIdentity,
    leaseToken: string,
    now: number
  ) {
    return this.updateLease(
      identity,
      leaseToken,
      record => {
        if (!record.executionId) {
          throw new McpInvocationConflictError(
            "MCP invocation cannot complete before an Execution is bound"
          );
        }

        return {
          ...record,
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
      record => ({
        ...record,
        status:
          record.executionId
            ? "bound"
            : "claimed",
        leaseExpiresAt: now,
        updatedAt: now
      })
    );
  }

  private pathFor(
    identity: McpInvocationIdentity
  ) {
    const digest = createHash("sha256")
      .update(identityKey(identity))
      .digest("hex");

    return join(
      this.directory,
      `${digest}.json`
    );
  }

  private async updateLease(
    identity: McpInvocationIdentity,
    leaseToken: string,
    update:
      (
        record: McpInvocationRecord
      ) => McpInvocationRecord
  ) {
    return this.withLock(
      identity,
      async path => {
        const current =
          await this.readIdentityRecord(
            path,
            identity
          );
        assertLease(
          current,
          leaseToken
        );
        const next = update(current);
        await this.writeRecord(
          path,
          next
        );
        return next;
      }
    );
  }

  private async readRecord(
    path: string
  ): Promise<McpInvocationRecord | null> {
    try {
      const parsed = JSON.parse(
        await readFile(path, "utf8")
      ) as McpInvocationRecord;

      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.principalKey !==
          "string" ||
        typeof parsed.toolName !==
          "string" ||
        typeof parsed.idempotencyKey !==
          "string" ||
        typeof parsed.accessScopeKey !==
          "string" ||
        typeof parsed.requestHash !==
          "string" ||
        typeof parsed.leaseToken !==
          "string" ||
        ![
          "claimed",
          "bound",
          "complete"
        ].includes(parsed.status) ||
        (
          parsed.executionId !==
            undefined &&
          typeof parsed.executionId !==
            "string"
        ) ||
        (
          parsed.status !== "claimed" &&
          !parsed.executionId
        ) ||
        (
          parsed.status === "claimed" &&
          parsed.executionId !== undefined
        ) ||
        !Number.isFinite(
          parsed.leaseExpiresAt
        ) ||
        !Number.isFinite(
          parsed.createdAt
        ) ||
        !Number.isFinite(
          parsed.updatedAt
        )
      ) {
        throw new Error(
          "Invalid MCP invocation record shape"
        );
      }

      return parsed;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code ===
          "ENOENT"
      ) {
        return null;
      }

      throw new McpInvocationStoreCorruptError(
        path,
        error
      );
    }
  }

  private async readIdentityRecord(
    path: string,
    identity: McpInvocationIdentity
  ) {
    const record =
      await this.readRecord(path);

    if (
      record &&
      identityKey(record) !==
        identityKey(identity)
    ) {
      throw new McpInvocationStoreCorruptError(
        path,
        new Error(
          "MCP invocation record identity does not match its path"
        )
      );
    }

    return record;
  }

  private async writeRecord(
    path: string,
    record: McpInvocationRecord
  ) {
    await mkdir(
      this.directory,
      { recursive: true }
    );
    const temporary =
      `${path}.tmp-${randomUUID()}`;
    const handle = await open(
      temporary,
      "wx"
    );

    try {
      await handle.writeFile(
        JSON.stringify(record),
        "utf8"
      );
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporary, path);
      try {
        const directoryHandle =
          await open(this.directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      } catch (error) {
        if (
          ![
            "EISDIR",
            "EINVAL",
            "EPERM",
            "ENOTSUP"
          ].includes(
            (error as NodeJS.ErrnoException).code ??
              ""
          )
        ) {
          throw error;
        }
      }
    } catch (error) {
      await unlink(temporary).catch(
        () => undefined
      );
      throw error;
    }
  }

  private async withLock<T>(
    identity: McpInvocationIdentity,
    operation:
      (path: string) => Promise<T>
  ): Promise<T> {
    await mkdir(
      this.directory,
      { recursive: true }
    );
    const path = this.pathFor(identity);
    const lockPath = `${path}.lock`;
    const startedAt = Date.now();

    while (true) {
      let handle:
        Awaited<ReturnType<typeof open>>;

      try {
        handle = await open(
          lockPath,
          "wx"
        );
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !==
            "EEXIST"
        ) {
          throw error;
        }

        try {
          const lockStat = await stat(
            lockPath
          );
          if (
            Date.now() -
              lockStat.mtimeMs >=
            this.staleLockMs
          ) {
            await unlink(lockPath);
            continue;
          }
        } catch (lockError) {
          if (
            (lockError as NodeJS.ErrnoException).code ===
              "ENOENT"
          ) {
            continue;
          }
          throw lockError;
        }

        if (
          Date.now() - startedAt >=
          this.lockTimeoutMs
        ) {
          throw new Error(
            "Timed out acquiring the MCP invocation record lock"
          );
        }

        await new Promise<void>(resolve => {
          setTimeout(
            resolve,
            this.lockRetryMs
          );
        });
        continue;
      }

      try {
        return await operation(path);
      } finally {
        await handle.close();
        await unlink(lockPath).catch(
          () => undefined
        );
      }
    }
  }
}
