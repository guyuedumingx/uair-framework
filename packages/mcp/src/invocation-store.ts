import {
  createHash
} from "node:crypto";
import {
  mkdir,
  open,
  readFile
} from "node:fs/promises";
import {
  join
} from "node:path";

export type McpInvocationIdentity = {
  principalKey: string;
  toolName: string;
  idempotencyKey: string;
};

export type McpInvocationRecord =
  McpInvocationIdentity & {
    executionId: string;
    createdAt: number;
  };

export interface McpInvocationStore {
  find(
    identity: McpInvocationIdentity
  ): Promise<McpInvocationRecord | null>;

  saveIfAbsent(
    record: McpInvocationRecord
  ): Promise<McpInvocationRecord>;
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

  async saveIfAbsent(
    record: McpInvocationRecord
  ) {
    const key = identityKey(record);
    const existing = this.records.get(key);

    if (existing) {
      return existing;
    }

    this.records.set(key, record);
    return record;
  }
}

export class JsonFileMcpInvocationStore
implements McpInvocationStore {
  constructor(
    private readonly directory: string
  ) {}

  async find(
    identity: McpInvocationIdentity
  ) {
    try {
      return JSON.parse(
        await readFile(
          this.pathFor(identity),
          "utf8"
        )
      ) as McpInvocationRecord;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }

  async saveIfAbsent(
    record: McpInvocationRecord
  ) {
    await mkdir(
      this.directory,
      { recursive: true }
    );

    const path = this.pathFor(record);

    try {
      const handle = await open(path, "wx");

      try {
        await handle.writeFile(
          JSON.stringify(record),
          "utf8"
        );
        await handle.sync();
      } finally {
        await handle.close();
      }

      return record;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST"
      ) {
        throw error;
      }

      return this.readWinner(path);
    }
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

  private async readWinner(
    path: string
  ): Promise<McpInvocationRecord> {
    for (
      let attempt = 0;
      attempt < 20;
      attempt += 1
    ) {
      try {
        const contents = await readFile(path, "utf8");

        if (contents) {
          return JSON.parse(contents) as McpInvocationRecord;
        }
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" &&
          !(error instanceof SyntaxError)
        ) {
          throw error;
        }
      }

      await new Promise<void>(resolve => {
        setTimeout(resolve, 5);
      });
    }

    throw new Error(
      "Timed out reading the winning MCP invocation record"
    );
  }
}
