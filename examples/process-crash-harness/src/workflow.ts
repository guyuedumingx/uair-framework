import {
  component,
  workflow
} from "@uair/core";
import {
  DatabaseSync
} from "node:sqlite";

export type CrashHarnessInput = {
  businessId: string;
};

export function createCrashWorkflow(
  sideEffectFile: string
) {
  const approval =
    component<
      CrashHarnessInput,
      {
        approved: boolean;
      }
    >(
      "processCrash.approval",
      async (
        input,
        ctx
      ) =>
        ctx.suspend({
          type: "event",
          eventType:
            "approval",
          key:
            input.businessId
        })
    );

  const externalSideEffect =
    component<
      CrashHarnessInput,
      {
        committed: true;
        effectId: string;
      }
    >(
      "processCrash.externalSideEffect",
      async (
        input,
        ctx
      ) => {
        const db =
          new DatabaseSync(
            sideEffectFile
          );

        try {
          db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;

            CREATE TABLE IF NOT EXISTS invocations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              business_id TEXT NOT NULL,
              effect_id TEXT NOT NULL,
              invoked_at INTEGER NOT NULL
            );
          `);

          db.prepare(`
            INSERT INTO invocations (
              business_id,
              effect_id,
              invoked_at
            ) VALUES (?, ?, ?)
          `).run(
            input.businessId,
            ctx.effectId,
            Date.now()
          );
        } finally {
          db.close();
        }

        return {
          committed: true,
          effectId:
            ctx.effectId
        };
      }
    );

  return workflow(
    "process-crash.order",
    {
      version: "1",
      deploymentId:
        "process-crash-v1"
    },
    async (
      input:
        CrashHarnessInput
    ) => {
      const decision =
        await approval(
          input
        );

      if (!decision.approved) {
        return {
          status:
            "rejected" as const
        };
      }

      const committed =
        await externalSideEffect(
          input
        );

      return {
        status:
          "completed" as const,
        committed
      };
    }
  );
}
