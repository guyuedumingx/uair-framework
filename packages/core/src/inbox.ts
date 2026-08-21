import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import {
  dirname
} from "node:path";
import type {
  ExternalEvent
} from "./resolver.js";

export type InboxRecord = {
  event: ExternalEvent;
  receivedAt: number;
  consumedAt?: number;
};

export interface InboxStore {
  put(
    event: ExternalEvent
  ): Promise<void>;

  listPending():
    Promise<InboxRecord[]>;

  markConsumed(
    eventId: string
  ): Promise<void>;
}

export class JsonInboxStore
  implements InboxStore {
  private tail:
    Promise<void> =
      Promise.resolve();

  constructor(
    private readonly file =
      ".uair/inbox.json"
  ) {}

  private async load():
    Promise<InboxRecord[]> {
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
      records: InboxRecord[]
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

  async put(
    event: ExternalEvent
  ) {
    await this.mutate(
      records => {
        if (
          records.some(
            item =>
              item.event.id ===
              event.id
          )
        ) {
          return;
        }

        records.push({
          event,
          receivedAt: Date.now()
        });
      }
    );
  }

  async listPending() {
    await this.tail;

    const records =
      await this.load();

    return records.filter(
      item =>
        item.consumedAt ===
        undefined
    );
  }

  async markConsumed(
    eventId: string
  ) {
    await this.mutate(
      records => {
        const record =
          records.find(
            item =>
              item.event.id ===
              eventId
          );

        if (
          record &&
          record.consumedAt ===
            undefined
        ) {
          record.consumedAt =
            Date.now();
        }
      }
    );
  }
}
