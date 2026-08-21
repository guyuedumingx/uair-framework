import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import {
  dirname
} from "node:path";

export type OutboxRecord = {
  id: string;
  requestId: string;
  executionId: string;
  reason:
    | "event"
    | "timer"
    | "manual"
    | "recovery";
  createdAt: number;
  deliveredAt?: number;
};

export interface OutboxStore {
  ensure(
    requestId: string,
    executionId: string,
    reason:
      | "event"
      | "timer"
      | "manual"
      | "recovery"
  ): Promise<OutboxRecord>;

  listPending():
    Promise<OutboxRecord[]>;

  hasRequest(
    requestId: string
  ): Promise<boolean>;

  markDelivered(
    id: string
  ): Promise<void>;
}

export class JsonOutboxStore
  implements OutboxStore {
  private tail:
    Promise<void> =
      Promise.resolve();

  constructor(
    private readonly file =
      ".uair/outbox.json"
  ) {}

  private async load():
    Promise<OutboxRecord[]> {
    try {
      const raw =
        await readFile(
          this.file,
          "utf8"
        );

      return JSON.parse(raw);
    } catch (error: any) {
      if (
        error?.code === "ENOENT"
      ) {
        return [];
      }

      throw error;
    }
  }

  private async mutate(
    fn: (
      records: OutboxRecord[]
    ) => void
  ) {
    const op =
      this.tail.then(
        async () => {
          const records =
            await this.load();

          fn(records);

          await mkdir(
            dirname(this.file),
            {
              recursive: true
            }
          );

          await writeFile(
            this.file,
            JSON.stringify(
              records,
              null,
              2
            ),
            "utf8"
          );
        }
      );

    this.tail =
      op.catch(
        () => {}
      );

    await op;
  }

  async ensure(
    requestId: string,
    executionId: string,
    reason:
      | "event"
      | "timer"
      | "manual"
      | "recovery"
  ) {
    let result!:
      OutboxRecord;

    await this.mutate(
      records => {
        const existing =
          records.find(
            item =>
              item.requestId ===
              requestId
          );

        if (existing) {
          result = existing;
          return;
        }

        result = {
          id:
            `out_${requestId}`,
          requestId,
          executionId,
          reason,
          createdAt: Date.now()
        };

        records.push(result);
      }
    );

    return result;
  }

  async listPending() {
    await this.tail;

    const records =
      await this.load();

    return records.filter(
      item =>
        item.deliveredAt ===
        undefined
    );
  }

  async hasRequest(
    requestId: string
  ) {
    await this.tail;

    const records =
      await this.load();

    return records.some(
      item =>
        item.requestId ===
        requestId
    );
  }

  async markDelivered(
    id: string
  ) {
    await this.mutate(
      records => {
        const record =
          records.find(
            item =>
              item.id === id
          );

        if (
          record &&
          record.deliveredAt ===
            undefined
        ) {
          record.deliveredAt =
            Date.now();
        }
      }
    );
  }
}
