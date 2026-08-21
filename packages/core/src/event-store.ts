import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import {
  dirname
} from "node:path";

export interface EventReceiptStore {
  has(
    eventId: string
  ): Promise<boolean>;

  record(
    eventId: string
  ): Promise<void>;
}

export class JsonEventReceiptStore
  implements EventReceiptStore {
  private tail:
    Promise<void> =
      Promise.resolve();

  constructor(
    private readonly file =
      ".uair/event-receipts.json"
  ) {}

  private async load():
    Promise<Record<string, number>> {
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
        return {};
      }

      throw error;
    }
  }

  async has(
    eventId: string
  ): Promise<boolean> {
    await this.tail;

    const data =
      await this.load();

    return (
      data[eventId] !==
      undefined
    );
  }

  async record(
    eventId: string
  ): Promise<void> {
    const operation =
      this.tail.then(
        async () => {
          const data =
            await this.load();

          data[eventId] =
            Date.now();

          await mkdir(
            dirname(this.file),
            {
              recursive: true
            }
          );

          await writeFile(
            this.file,
            JSON.stringify(
              data,
              null,
              2
            ),
            "utf8"
          );
        }
      );

    this.tail =
      operation.catch(
        () => {}
      );

    await operation;
  }
}
