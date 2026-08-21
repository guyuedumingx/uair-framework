import type {
  WorkflowDefinition,
  Execution,
  ResumeRequested
} from "./types.js";
import {
  VersionedWorkflowRegistry,
  migrateExecutionHistory,
  builtinHistoryMigrations,
  CURRENT_HISTORY_SCHEMA_VERSION,
  type HistoryMigration
} from "./versioning.js";
import type { Storage } from "./storage.js";
import {
  resumeExecution,
  resolveSuspension
} from "./runtime.js";
import {
  findDueTimers
} from "./scheduler.js";
import {
  findEventWaiters,
  type ExternalEvent
} from "./resolver.js";
import type {
  LockManager
} from "./lock.js";
import {
  InMemoryLockManager
} from "./lock.js";
import type {
  ResumeQueue
} from "./queue.js";
import {
  InMemoryResumeQueue
} from "./queue.js";
import type {
  EventReceiptStore
} from "./event-store.js";
import {
  JsonEventReceiptStore
} from "./event-store.js";
import type {
  InboxStore
} from "./inbox.js";
import {
  JsonInboxStore
} from "./inbox.js";
import type {
  OutboxStore
} from "./outbox.js";
import {
  JsonOutboxStore
} from "./outbox.js";

export type WorkflowRegistry = Record<
  string,
  WorkflowDefinition<any, any>
>;

export type RuntimeWorkflowRegistry =
  | WorkflowRegistry
  | WorkflowDefinition<any, any>[]
  | VersionedWorkflowRegistry;

export class RuntimeEngine {
  private readonly workflows:
    VersionedWorkflowRegistry;

  constructor(
    private readonly storage: Storage,
    workflows:
      RuntimeWorkflowRegistry,
    private readonly locks:
      LockManager =
        new InMemoryLockManager(),
    private readonly queue:
      ResumeQueue =
        new InMemoryResumeQueue(),
    private readonly receipts:
      EventReceiptStore =
        new JsonEventReceiptStore(),
    private readonly inbox:
      InboxStore =
        new JsonInboxStore(),
    private readonly outbox:
      OutboxStore =
        new JsonOutboxStore(),
    private readonly historyMigrations:
      HistoryMigration[] =
        builtinHistoryMigrations
  ) {
    if (
      workflows instanceof
      VersionedWorkflowRegistry
    ) {
      this.workflows =
        workflows;
    } else {
      this.workflows =
        new VersionedWorkflowRegistry(
          Array.isArray(workflows)
            ? workflows
            : Object.values(
                workflows
              )
        );
    }
  }

  private resumeRequests(
    execution: Execution
  ): ResumeRequested[] {
    return execution.history.filter(
      (
        entry
      ): entry is ResumeRequested =>
        entry.kind ===
          "resume_requested"
    );
  }

  private async rebuildOutbox():
    Promise<void> {
    const executions =
      await this.storage.listExecutions();

    for (const execution of executions) {
      for (
        const request
        of this.resumeRequests(execution)
      ) {
        await this.outbox.ensure(
          request.requestId,
          execution.id,
          request.reason
        );
      }
    }
  }

  private async dispatchOutbox():
    Promise<void> {
    const records =
      await this.outbox.listPending();

    for (const record of records) {
      await this.queue.enqueue({
        executionId:
          record.executionId,
        reason:
          record.reason === "recovery"
            ? "manual"
            : record.reason
      });
    }
  }

  async drainQueue():
    Promise<Execution[]> {
    const jobs =
      await this.queue.drain();

    const results:
      Execution[] = [];

    for (const job of jobs) {
      const result =
        await this.locks.withLock(
          `execution:${job.executionId}`,
          async () => {
            const latest =
              await this.storage
                .loadExecution(
                  job.executionId
                );

            if (!latest) {
              throw new Error(
                `Execution not found: ${job.executionId}`
              );
            }

            if (
              latest.status ===
                "completed" ||
              latest.status ===
                "cancelled"
            ) {
              return latest;
            }

            const originalSchema =
              latest.historySchemaVersion ??
              1;

            const migrated =
              migrateExecutionHistory(
                latest,
                this.historyMigrations,
                CURRENT_HISTORY_SCHEMA_VERSION
              );

            if (
              originalSchema !==
              migrated.historySchemaVersion
            ) {
              await this.storage
                .saveExecution(
                  migrated
                );
            }

            let workflow =
              this.workflows
                .resolveExecution(
                  migrated
                );

            let executionToResume =
              migrated;

            if (!workflow) {
              const upgraded =
                this.workflows
                  .upgradeExecution(
                    migrated
                  );

              if (upgraded) {
                executionToResume =
                  upgraded.execution;

                workflow =
                  upgraded.workflow;

                await this.storage
                  .saveExecution(
                    executionToResume
                  );
              }
            }

            if (!workflow) {
              throw new Error(
                `Workflow version not registered: ` +
                `${migrated.workflow}@${migrated.workflowVersion ?? "1"}`
              );
            }

            return resumeExecution(
              workflow,
              executionToResume.id,
              this.storage
            );
          }
        );

      results.push(result);
    }

    // Only mark outbox records delivered after the worker has
    // processed the execution. If the process dies before this point,
    // recovery will dispatch the same request again; execution locking
    // and replay make that safe.
    const pending =
      await this.outbox.listPending();

    for (const record of pending) {
      if (
        jobs.some(
          job =>
            job.executionId ===
            record.executionId
        )
      ) {
        await this.outbox.markDelivered(
          record.id
        );
      }
    }

    return results;
  }

  private async dispatchAndDrain() {
    await this.rebuildOutbox();
    await this.dispatchOutbox();
    return this.drainQueue();
  }

  private async resolveEventWaiters(
    event: ExternalEvent
  ): Promise<Execution[]> {
    const waiters =
      await findEventWaiters(
        this.storage,
        event
      );

    const executions:
      Execution[] = [];

    for (const waiter of waiters) {
      const resolved =
        await this.locks.withLock(
          `execution:${waiter.executionId}`,
          async () => {
            const stillIndexed =
              await this.storage
                .findSuspension(
                  waiter.suspension
                    .suspensionId
                );

            if (!stillIndexed) {
              return null;
            }

            return resolveSuspension(
              waiter.suspension
                .suspensionId,
              event.value,
              this.storage,
              "event"
            );
          }
        );

      if (resolved) {
        executions.push(resolved);
      }
    }

    return executions;
  }

  private async replayInbox():
    Promise<void> {
    const pending =
      await this.inbox.listPending();

    for (const record of pending) {
      const event =
        record.event;

      const matched =
        await this.resolveEventWaiters(
          event
        );

      if (matched.length > 0) {
        await this.receipts.record(
          event.id
        );

        await this.inbox.markConsumed(
          event.id
        );
      }
    }
  }

  async tick(
    now = Date.now()
  ): Promise<Execution[]> {
    const due =
      await findDueTimers(
        this.storage,
        now
      );

    for (const item of due) {
      await this.locks.withLock(
        `execution:${item.execution.id}`,
        async () => {
          const indexed =
            await this.storage
              .findSuspension(
                item.suspension
                  .suspensionId
              );

          if (!indexed) {
            return;
          }

          const spec =
            item.suspension.spec;

          const value =
            typeof spec === "object" &&
            spec !== null
              ? (spec as any).value
              : undefined;

          await resolveSuspension(
            item.suspension
              .suspensionId,
            value,
            this.storage,
            "timer"
          );
        }
      );
    }

    return this.dispatchAndDrain();
  }

  async emit(
    event: ExternalEvent
  ): Promise<Execution[]> {
    return this.locks.withLock(
      `event:${event.id}`,
      async () => {
        if (
          await this.receipts.has(
            event.id
          )
        ) {
          return [];
        }

        // Persist ingress first. If the process dies before a waiter
        // exists or before matching finishes, recovery can replay it.
        await this.inbox.put(event);

        const matched =
          await this.resolveEventWaiters(
            event
          );

        if (matched.length > 0) {
          await this.receipts.record(
            event.id
          );

          await this.inbox.markConsumed(
            event.id
          );
        }

        return this.dispatchAndDrain();
      }
    );
  }

  /**
   * Crash recovery entry point.
   *
   * 1. Replay unmatched durable inbox events against newly-created
   *    waiters.
   * 2. Discover due timers.
   * 3. Rebuild the external outbox from transactional
   *    `resume_requested` history records.
   * 4. Dispatch pending resume jobs and drain them.
   */
  async recover(
    now = Date.now()
  ): Promise<Execution[]> {
    await this.replayInbox();

    const due =
      await findDueTimers(
        this.storage,
        now
      );

    for (const item of due) {
      await this.locks.withLock(
        `execution:${item.execution.id}`,
        async () => {
          const indexed =
            await this.storage
              .findSuspension(
                item.suspension
                  .suspensionId
              );

          if (!indexed) {
            return;
          }

          const spec =
            item.suspension.spec;

          const value =
            typeof spec === "object" &&
            spec !== null
              ? (spec as any).value
              : undefined;

          await resolveSuspension(
            item.suspension
              .suspensionId,
            value,
            this.storage,
            "recovery"
          );
        }
      );
    }

    return this.dispatchAndDrain();
  }
}
