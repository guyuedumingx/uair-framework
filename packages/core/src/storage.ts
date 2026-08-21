import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename
} from "node:fs/promises";
import {
  dirname,
  join
} from "node:path";
import {
  randomUUID
} from "node:crypto";
import type {
  Execution,
  SuspensionCreated
} from "./types.js";

export class StorageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConflictError";
  }
}

export interface Storage {
  loadExecution(
    id: string
  ): Promise<Execution | null>;

  saveExecution(
    execution: Execution,
    expectedRevision?: number
  ): Promise<void>;

  listExecutions(): Promise<Execution[]>;

  findSuspension(
    suspensionId: string
  ): Promise<{
    executionId: string;
    suspension: SuspensionCreated;
  } | null>;

  indexSuspension(
    executionId: string,
    suspension: SuspensionCreated
  ): Promise<void>;

  removeSuspensionIndex(
    suspensionId: string
  ): Promise<void>;

  listSuspensions(): Promise<Array<{
    executionId: string;
    suspension: SuspensionCreated;
  }>>;

  saveExecutionAndIndexSuspension?(
    execution: Execution,
    suspension: SuspensionCreated,
    expectedRevision?: number
  ): Promise<void>;

  saveExecutionAndRemoveSuspension?(
    execution: Execution,
    suspensionId: string,
    expectedRevision?: number
  ): Promise<void>;
}

export class JsonFileStorage implements Storage {
  constructor(
    private readonly dir =
      ".uair/executions"
  ) {}

  private file(id: string) {
    return join(
      this.dir,
      `${id}.json`
    );
  }

  private indexDir() {
    return join(
      dirname(this.dir),
      "suspensions"
    );
  }

  private indexFile(
    suspensionId: string
  ) {
    return join(
      this.indexDir(),
      `${suspensionId}.json`
    );
  }

  async loadExecution(
    id: string
  ): Promise<Execution | null> {
    try {
      const raw =
        await readFile(
          this.file(id),
          "utf8"
        );

      return JSON.parse(
        raw
      ) as Execution;
    } catch (error: any) {
      if (
        error?.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }

  async saveExecution(
    execution: Execution,
    expectedRevision?: number
  ): Promise<void> {
    await mkdir(
      this.dir,
      {
        recursive: true
      }
    );

    const path =
      this.file(execution.id);

    const current =
      await this.loadExecution(
        execution.id
      );

    const currentRevision =
      current?.revision ?? 0;

    if (
      expectedRevision !== undefined &&
      currentRevision !==
        expectedRevision
    ) {
      throw new StorageConflictError(
        `Execution ${execution.id} revision conflict. ` +
        `Expected ${expectedRevision}, found ${currentRevision}.`
      );
    }

    execution.revision =
      currentRevision + 1;

    const temp =
      `${path}.${process.pid}.${randomUUID()}.tmp`;

    await writeFile(
      temp,
      JSON.stringify(
        execution,
        null,
        2
      ),
      "utf8"
    );

    await rename(
      temp,
      path
    );
  }

  async listExecutions():
    Promise<Execution[]> {
    await mkdir(
      this.dir,
      {
        recursive: true
      }
    );

    const names =
      await readdir(this.dir);

    const result:
      Execution[] = [];

    for (const name of names) {
      if (
        !name.endsWith(".json")
      ) {
        continue;
      }

      const raw =
        await readFile(
          join(this.dir, name),
          "utf8"
        );

      result.push(
        JSON.parse(raw)
      );
    }

    return result;
  }

  async indexSuspension(
    executionId: string,
    suspension:
      SuspensionCreated
  ): Promise<void> {
    await mkdir(
      this.indexDir(),
      {
        recursive: true
      }
    );

    await writeFile(
      this.indexFile(
        suspension.suspensionId
      ),
      JSON.stringify(
        {
          executionId,
          suspension
        },
        null,
        2
      ),
      "utf8"
    );
  }

  async removeSuspensionIndex(
    suspensionId: string
  ): Promise<void> {
    const path =
      this.indexFile(
        suspensionId
      );

    try {
      const fs =
        await import(
          "node:fs/promises"
        );

      await fs.unlink(path);
    } catch (error: any) {
      if (
        error?.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }

  async findSuspension(
    suspensionId: string
  ) {
    try {
      const raw =
        await readFile(
          this.indexFile(
            suspensionId
          ),
          "utf8"
        );

      return JSON.parse(raw) as {
        executionId: string;
        suspension:
          SuspensionCreated;
      };
    } catch (error: any) {
      if (
        error?.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }

  async listSuspensions() {
    await mkdir(
      this.indexDir(),
      {
        recursive: true
      }
    );

    const names =
      await readdir(
        this.indexDir()
      );

    const result: Array<{
      executionId: string;
      suspension:
        SuspensionCreated;
    }> = [];

    for (const name of names) {
      if (
        !name.endsWith(".json")
      ) {
        continue;
      }

      const raw =
        await readFile(
          join(
            this.indexDir(),
            name
          ),
          "utf8"
        );

      result.push(
        JSON.parse(raw)
      );
    }

    return result;
  }

}
