import { AsyncLocalStorage } from "node:async_hooks";import {
  fingerprintWorkflow,
  assertExecutionWorkflowIdentity
} from "./deployment.js";

import { randomUUID } from "node:crypto";
import type {
  ComponentContext,
  ComponentOptions,
  Execution,
  HistoryEntry,
  PreviousResult,
  SuspensionCreated,
  SuspensionResolved,
  SuspendOptions,
  WorkflowDefinition
} from "./types.js";
import {
  StorageConflictError
} from "./storage.js";

import type {
  Storage
} from "./storage.js";

type ScopeFrame = {
  prefix: string;
  cursor: number;
  signal: AbortSignal;
};

type RuntimeFrame = {
  execution: Execution;
  storage: Storage;
  scope: ScopeFrame;
};

type ManagedHistoryEntry = Extract<
  HistoryEntry,
  {
    kind:
      | "effect_completed"
      | "suspension_created";
  }
>;

const runtimeStorage = new AsyncLocalStorage<RuntimeFrame>();

export class SuspendExecution extends Error {
  constructor(
    public readonly suspensionId: string
  ) {
    super(`Execution suspended: ${suspensionId}`);
    this.name = "SuspendExecution";
  }
}
export class NonDeterministicWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonDeterministicWorkflowError";
  }
}
export class ExecutionCancelledError extends Error {
  constructor(message = "Execution cancelled") {
    super(message);
    this.name = "ExecutionCancelledError";
  }
}

export function currentFrame(): RuntimeFrame {
  const frame = runtimeStorage.getStore();
  if (!frame) {
    throw new Error(
      "UAIR component called outside a running workflow"
    );
  }
  return frame;
}

function joinPath(
  prefix: string,
  segment: string | number
): string {
  return prefix
    ? `${prefix}.${segment}`
    : String(segment);
}

export function allocateScopePath(): string {
  const frame = currentFrame();
  const path = joinPath(
    frame.scope.prefix,
    frame.scope.cursor
  );
  frame.scope.cursor += 1;
  return path;
}

export async function runInScope<T>(
  prefix: string,
  signal: AbortSignal,
  fn: () => Promise<T> | T
): Promise<T> {
  const parent = currentFrame();

  return runtimeStorage.run(
    {
      execution: parent.execution,
      storage: parent.storage,
      scope: {
        prefix,
        cursor: 0,
        signal
      }
    },
    async () => fn()
  );
}

function entriesAtPath(
  history: HistoryEntry[],
  path: string
): ManagedHistoryEntry[] {
  return history.filter(
    (
      entry
    ): entry is ManagedHistoryEntry =>
      (
        entry.kind === "effect_completed" ||
        entry.kind === "suspension_created"
      ) &&
      entry.path === path
  );
}

function latestEntryAtPath(
  history: HistoryEntry[],
  path: string
): ManagedHistoryEntry | undefined {
  return entriesAtPath(history, path)
    .sort((a, b) =>
      (b.generation ?? 0) -
      (a.generation ?? 0)
    )[0];
}

function nextGeneration(
  history: HistoryEntry[],
  path: string
): number {
  const entries = entriesAtPath(history, path);
  if (entries.length === 0) return 0;

  return Math.max(
    ...entries.map(
      entry => entry.generation ?? 0
    )
  ) + 1;
}

function findResolution(
  history: HistoryEntry[],
  suspensionId: string
): SuspensionResolved | undefined {
  return history.find(
    (
      entry
    ): entry is SuspensionResolved =>
      entry.kind === "suspension_resolved" &&
      entry.suspensionId === suspensionId
  );
}

function isSuspensionCancelled(
  history: HistoryEntry[],
  suspensionId: string
): boolean {
  return history.some(
    entry =>
      entry.kind === "suspension_cancelled" &&
      entry.suspensionId === suspensionId
  );
}

function isResolvedValueFresh(
  created: SuspensionCreated,
  resolved: SuspensionResolved,
  now: number
): boolean {
  if (
    created.resultValidForMs === undefined
  ) {
    return true;
  }

  return (
    resolved.resolvedAt +
      created.resultValidForMs >
    now
  );
}

function isPendingSuspensionFresh(
  created: SuspensionCreated,
  now: number
): boolean {
  return (
    created.expiresAt === undefined ||
    created.expiresAt > now
  );
}


function isEffectFresh(
  completed: Extract<
    HistoryEntry,
    { kind: "effect_completed" }
  >,
  now: number
): boolean {
  return (
    completed.expiresAt === undefined ||
    completed.expiresAt > now
  );
}

function serializeError(
  error: unknown
) {
  const value = error as any;

  return {
    name: value?.name ?? "Error",
    message:
      value?.message ?? String(error),
    stack: value?.stack
  };
}

async function sleepLocal(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  if (ms <= 0) return;

  await new Promise<void>(
    (resolve, reject) => {
      const timer = setTimeout(
        resolve,
        ms
      );

      const abort = () => {
        clearTimeout(timer);
        reject(
          new ExecutionCancelledError()
        );
      };

      if (signal.aborted) {
        abort();
        return;
      }

      signal.addEventListener(
        "abort",
        abort,
        { once: true }
      );
    }
  );
}

export async function invokeComponent<I, O>(
  componentName: string,
  input: I,
  options: ComponentOptions,
  handler: (
    input: I,
    ctx: ComponentContext
  ) => Promise<O>
): Promise<O> {
  const frame = currentFrame();

  if (frame.scope.signal.aborted) {
    throw new ExecutionCancelledError();
  }

  const path = allocateScopePath();
  const existing = latestEntryAtPath(
    frame.execution.history,
    path
  );

  if (
    existing &&
    existing.component !== componentName
  ) {
    throw new NonDeterministicWorkflowError(
      `History mismatch at path ${path}. ` +
      `Expected component "${existing.component}", ` +
      `received "${componentName}".`
    );
  }

  const now = Date.now();
  let previous:
    PreviousResult | undefined;

  if (
    existing?.kind === "effect_completed"
  ) {
    if (
      isEffectFresh(existing, now)
    ) {
      return existing.output as O;
    }

    previous = {
      source: "effect",
      value: existing.output,
      generation: existing.generation,
      completedAt:
        existing.completedAt
    };
  }

  if (
    existing?.kind === "suspension_created"
  ) {
    const cancelled =
      isSuspensionCancelled(
        frame.execution.history,
        existing.suspensionId
      );

    const resolution = findResolution(
      frame.execution.history,
      existing.suspensionId
    );

    if (
      !cancelled &&
      resolution &&
      isResolvedValueFresh(
        existing,
        resolution,
        now
      )
    ) {
      return resolution.value as O;
    }

    // Timer suspensions are a special resolver: once their deadline
    // has passed, replay can resolve them locally without an external
    // user/webhook.
    if (
      !cancelled &&
      !resolution &&
      typeof existing.spec === "object" &&
      existing.spec !== null &&
      (existing.spec as any).type === "timer" &&
      typeof (existing.spec as any).deadline === "number" &&
      (existing.spec as any).deadline <= now
    ) {
      const timerResolution: SuspensionResolved = {
        kind: "suspension_resolved",
        suspensionId: existing.suspensionId,
        resolvedAt: now,
        value: (existing.spec as any).value
      };

      frame.execution.history.push(
        timerResolution
      );

      await frame.storage.saveExecution(
        frame.execution
      );

      return timerResolution.value as O;
    }

    if (
      !cancelled &&
      !resolution &&
      isPendingSuspensionFresh(
        existing,
        now
      )
    ) {
      throw new SuspendExecution(
        existing.suspensionId
      );
    }

    if (resolution) {
      previous = {
        source: "suspension",
        value: resolution.value,
        generation: existing.generation,
        resolvedAt:
          resolution.resolvedAt
      };
    }

    // Either:
    // 1. the unresolved interaction itself expired, or
    // 2. its resolved result became stale.
    //
    // Re-run the component at the same structural path with a new
    // generation. ctx.previous lets the package author refresh an old
    // credential/result before falling back to a new interaction.
  }

  const generation = nextGeneration(
    frame.execution.history,
    path
  );

  const effectId =
    `${frame.execution.id}:${path}:g${generation}`;

  const childAbort =
    new AbortController();

  const relayAbort = () =>
    childAbort.abort(
      frame.scope.signal.reason
    );

  if (frame.scope.signal.aborted) {
    relayAbort();
  } else {
    frame.scope.signal.addEventListener(
      "abort",
      relayAbort,
      { once: true }
    );
  }

  let dynamicResultExpiry:
    number | undefined;

  const attributes = {
    ...(options.attributes ?? {})
  };

  const metrics:
    Record<string, number> = {};

  const maxAttempts = Math.max(
    1,
    options.retry?.maxAttempts ?? 1
  );

  let attempt = 0;

  try {
    while (attempt < maxAttempts) {
      attempt += 1;
      const attemptStartedAt =
        Date.now();

      const ctx: ComponentContext = {
        effectId,
        generation,
        attempt,
        signal: childAbort.signal,
        previous,

        setResultExpiry(
          expiresAt: number
        ) {
          dynamicResultExpiry =
            expiresAt;
        },

        setAttribute(
          key,
          value
        ) {
          attributes[key] =
            value;
        },

        addMetric(
          key,
          value
        ) {
          metrics[key] =
            (
              metrics[key] ??
              0
            ) + value;
        },

        async suspend<T>(
          spec: unknown,
          suspendOptions:
            SuspendOptions = {}
        ): Promise<T> {
          const createdAt = Date.now();
          const suspensionId =
            `sus_${randomUUID()}`;

          const created: SuspensionCreated = {
            kind: "suspension_created",
            path,
            component: componentName,
            effectId,
            generation,
            suspensionId,
            createdAt,
            input,
            expiresAt:
              suspendOptions.expiresInMs ===
              undefined
                ? undefined
                : createdAt +
                  suspendOptions.expiresInMs,
            resultValidForMs:
              suspendOptions.resultValidForMs,
            spec,
            attributes:
              Object.keys(
                attributes
              ).length
                ? {
                    ...attributes
                  }
                : undefined,
            metrics:
              Object.keys(
                metrics
              ).length
                ? {
                    ...metrics
                  }
                : undefined
          };

          frame.execution.history.push(
            created
          );
          frame.execution.status =
            "suspended";

          if (
            frame.storage
              .saveExecutionAndIndexSuspension
          ) {
            await frame.storage
              .saveExecutionAndIndexSuspension(
                frame.execution,
                created
              );
          } else {
            await frame.storage.saveExecution(
              frame.execution
            );

            await frame.storage.indexSuspension(
              frame.execution.id,
              created
            );
          }

          throw new SuspendExecution(
            suspensionId
          );
        }
      };

      try {
        const output = await runInScope(
          path,
          childAbort.signal,
          () => handler(input, ctx)
        );

        const completedAt = Date.now();

        frame.execution.history.push({
          kind: "effect_completed",
          path,
          component: componentName,
          effectId,
          generation,
          startedAt:
            attemptStartedAt,
          completedAt,
          input,
          attributes:
            Object.keys(
              attributes
            ).length
              ? {
                  ...attributes
                }
              : undefined,
          metrics:
            Object.keys(
              metrics
            ).length
              ? {
                  ...metrics
                }
              : undefined,
          expiresAt:
            dynamicResultExpiry ??
            (
              options.resultValidForMs ===
              undefined
                ? undefined
                : completedAt +
                  options.resultValidForMs
            ),
          output
        });

        await frame.storage.saveExecution(
          frame.execution
        );

        return output;
      } catch (error) {
        if (
          error instanceof SuspendExecution ||
          error instanceof ExecutionCancelledError
        ) {
          throw error;
        }

        frame.execution.history.push({
          kind: "effect_attempt_failed",
          path,
          component: componentName,
          effectId,
          generation,
          attempt,
          attemptStartedAt,
          failedAt: Date.now(),
          input,
          error: serializeError(error),
          attributes:
            Object.keys(
              attributes
            ).length
              ? {
                  ...attributes
                }
              : undefined,
          metrics:
            Object.keys(
              metrics
            ).length
              ? {
                  ...metrics
                }
              : undefined
        });

        await frame.storage.saveExecution(
          frame.execution
        );

        const shouldRetry =
          attempt < maxAttempts &&
          (
            options.retry?.retryIf
              ? options.retry.retryIf(
                  error,
                  attempt
                )
              : true
          );

        if (!shouldRetry) {
          throw error;
        }

        await sleepLocal(
          options.retry?.delayMs ?? 0,
          childAbort.signal
        );
      }
    }

    throw new Error(
      "unreachable retry state"
    );

  } finally {
    frame.scope.signal.removeEventListener(
      "abort",
      relayAbort
    );
  }
}

export async function runParallel<T>(
  branches: Array<
    () => Promise<T> | T
  >
): Promise<T[]> {
  const parent = currentFrame();
  const parallelPath = allocateScopePath();

  const controllers =
    branches.map(
      () => new AbortController()
    );

  const relayAbort = () => {
    for (const controller of controllers) {
      controller.abort(
        parent.scope.signal.reason
      );
    }
  };

  if (parent.scope.signal.aborted) {
    relayAbort();
  } else {
    parent.scope.signal.addEventListener(
      "abort",
      relayAbort,
      { once: true }
    );
  }

  try {
    const results = await Promise.allSettled(
      branches.map(
        (branch, index) =>
          runtimeStorage.run(
            {
              execution: parent.execution,
              storage: parent.storage,
              scope: {
                prefix: joinPath(
                  parallelPath,
                  index
                ),
                cursor: 0,
                signal:
                  controllers[index].signal
              }
            },
            async () => branch()
          )
      )
    );

    const hardFailure = results.find(
      (
        result
      ): result is PromiseRejectedResult =>
        result.status === "rejected" &&
        !(
          result.reason
          instanceof SuspendExecution
        )
    );

    if (hardFailure) {
      throw hardFailure.reason;
    }

    const suspended = results.find(
      (
        result
      ): result is PromiseRejectedResult =>
        result.status === "rejected" &&
        result.reason
          instanceof SuspendExecution
    );

    if (suspended) {
      throw suspended.reason;
    }

    return results.map(
      result =>
        (
          result as
            PromiseFulfilledResult<T>
        ).value
    );
  } finally {
    parent.scope.signal.removeEventListener(
      "abort",
      relayAbort
    );
  }
}

export async function runRace<T>(
  branches: Array<
    () => Promise<T> | T
  >
): Promise<T> {
  const parent = currentFrame();
  const racePath = allocateScopePath();

  const controllers =
    branches.map(
      () => new AbortController()
    );

  const suspendedByBranch:
    Array<SuspendExecution | undefined> =
      branches.map(() => undefined);

  const cancelKnownLosers =
    async (winnerIndex: number) => {
      let changed = false;

      suspendedByBranch.forEach(
        (suspension, index) => {
          if (
            index === winnerIndex ||
            !suspension
          ) {
            return;
          }

          if (
            !isSuspensionCancelled(
              parent.execution.history,
              suspension.suspensionId
            )
          ) {
            parent.execution.history.push({
              kind: "suspension_cancelled",
              suspensionId:
                suspension.suspensionId,
              cancelledAt: Date.now(),
              reason: "race_lost"
            });

            changed = true;
          }
        }
      );

      if (changed) {
        await parent.storage.saveExecution(
          parent.execution
        );
      }
    };

  const promises =
    branches.map(
      (branch, index) =>
        runtimeStorage.run(
          {
            execution: parent.execution,
            storage: parent.storage,
            scope: {
              prefix: joinPath(
                racePath,
                index
              ),
              cursor: 0,
              signal:
                controllers[index].signal
            }
          },
          async () => branch()
        )
    );

  return new Promise<T>(
    (resolve, reject) => {
      let settled = false;
      let suspensionError:
        SuspendExecution | undefined;
      let pending = promises.length;

      promises.forEach(
        (promise, index) => {
          promise.then(
            async (value: T) => {
              if (settled) return;
              settled = true;

              controllers.forEach(
                (controller, i) => {
                  if (i !== index) {
                    controller.abort(
                      "race_lost"
                    );
                  }
                }
              );

              await cancelKnownLosers(
                index
              );

              resolve(value);
            },
            (error: unknown) => {
              pending -= 1;

              if (
                error
                instanceof SuspendExecution
              ) {
                suspendedByBranch[index] =
                  error;
                suspensionError ??= error;
              } else if (
                !settled &&
                !(
                  error
                  instanceof ExecutionCancelledError
                )
              ) {
                settled = true;

                controllers.forEach(
                  (controller, i) => {
                    if (i !== index) {
                      controller.abort(
                        error
                      );
                    }
                  }
                );

                reject(error);
                return;
              }

              if (
                !settled &&
                pending === 0 &&
                suspensionError
              ) {
                reject(suspensionError);
              }
            }
          );
        }
      );
    }
  );
}

export async function runExecution<I, O>(
  workflow: WorkflowDefinition<I, O>,
  execution: Execution,
  storage: Storage
): Promise<Execution> {
  if (execution.status === "cancelled") {
    return execution;
  }

  execution.status = "running";
  execution.error = undefined;
  await storage.saveExecution(execution);

  const controller =
    new AbortController();

  const frame: RuntimeFrame = {
    execution,
    storage,
    scope: {
      prefix: "",
      cursor: 0,
      signal: controller.signal
    }
  };

  try {
    const result =
      await runtimeStorage.run(
        frame,
        () =>
          workflow.handler(
            execution.input as I
          )
      );

    execution.result = result;
    execution.status = "completed";
    await storage.saveExecution(execution);
    return execution;
  } catch (error: any) {
    if (error instanceof SuspendExecution) {
      execution.status = "suspended";
      await storage.saveExecution(
        execution
      );
      return execution;
    }

    if (
      error
      instanceof ExecutionCancelledError
    ) {
      execution.status = "cancelled";
      await storage.saveExecution(
        execution
      );
      return execution;
    }

    execution.status = "failed";
    execution.error = {
      name: error?.name ?? "Error",
      message:
        error?.message ?? String(error),
      stack: error?.stack
    };
    await storage.saveExecution(execution);
    throw error;
  }
}

export async function createExecution<I, O>(
  workflow: WorkflowDefinition<I, O>,
  input: I,
  storage: Storage
): Promise<Execution> {
  const execution: Execution = {
    id: `exp_${randomUUID()}`,
    workflow: workflow.name,
    workflowVersion:
      workflow.version,
    deploymentId:
      workflow.deploymentId,
    workflowFingerprint:
      fingerprintWorkflow(
        workflow
      ),
    historySchemaVersion: 4,
    input,
    status: "running",
    history: []
  };

  await storage.saveExecution(execution);

  return runExecution(
    workflow,
    execution,
    storage
  );
}

export async function resumeExecution<I, O>(
  workflow: WorkflowDefinition<I, O>,
  executionId: string,
  storage: Storage
): Promise<Execution> {
  const execution =
    await storage.loadExecution(
      executionId
    );

  if (!execution) {
    throw new Error(
      `Execution not found: ${executionId}`
    );
  }

  if (
    execution.workflow !== workflow.name
  ) {
    throw new Error(
      `Execution ${executionId} belongs to workflow ` +
      `"${execution.workflow}", not "${workflow.name}".`
    );
  }

  if (
    !execution.workflowFingerprint
  ) {
    const adoptedFingerprint =
      fingerprintWorkflow(
        workflow
      );

    execution.workflowFingerprint =
      adoptedFingerprint;

    execution.deploymentId =
      execution.deploymentId ??
      workflow.deploymentId;

    execution.history.push({
      kind:
        "workflow_identity_adopted",
      workflow:
        execution.workflow,
      version:
        execution.workflowVersion ??
        "1",
      fingerprint:
        adoptedFingerprint,
      deploymentId:
        execution.deploymentId,
      adoptedAt:
        Date.now()
    });

    await storage.saveExecution(
      execution
    );
  }

  const pinnedVersion =
    execution.workflowVersion ??
    "1";

  if (
    pinnedVersion !==
    workflow.version
  ) {
    throw new WorkflowVersionMismatchError(
      execution.id,
      execution.workflow,
      pinnedVersion,
      workflow.version
    );
  }

  assertExecutionWorkflowIdentity(
    execution,
    workflow
  );

  return runExecution(
    workflow,
    execution,
    storage
  );
}

export async function resolveSuspension(
  suspensionId: string,
  value: unknown,
  storage: Storage,
  reason:
    | "event"
    | "timer"
    | "manual"
    | "recovery" =
      "manual",
  resolvedBy?: string
): Promise<Execution> {
  const indexed =
    await storage.findSuspension(
      suspensionId
    );

  if (!indexed) {
    throw new Error(
      `Suspension not found: ${suspensionId}`
    );
  }

  const execution =
    await storage.loadExecution(
      indexed.executionId
    );

  if (!execution) {
    throw new Error(
      `Execution not found for suspension: ${suspensionId}`
    );
  }

  const existingResolution =
    execution.history.find(
      entry =>
        entry.kind ===
          "suspension_resolved" &&
        entry.suspensionId ===
          suspensionId
    );

  if (existingResolution) {
    return execution;
  }

  const cancelled =
    isSuspensionCancelled(
      execution.history,
      suspensionId
    );

  if (cancelled) {
    throw new Error(
      `Suspension already cancelled: ${suspensionId}`
    );
  }

  const now = Date.now();

  const expectedRevision =
    execution.revision ??
    0;

  execution.history.push({
    kind: "suspension_resolved",
    suspensionId,
    resolvedAt: now,
    value,
    resolvedBy
  });

  execution.history.push({
    kind: "resume_requested",
    requestId:
      `resume_${suspensionId}`,
    suspensionId,
    requestedAt: now,
    reason
  });

  // Resolution and resume intent are committed in one execution
  // snapshot. The external outbox can always be reconstructed from
  // this history if the process crashes before dispatch.
  try {
    if (
      storage
        .saveExecutionAndRemoveSuspension
    ) {
      await storage
        .saveExecutionAndRemoveSuspension(
          execution,
          suspensionId,
          expectedRevision
        );
    } else {
      await storage.saveExecution(
        execution,
        expectedRevision
      );

      await storage.removeSuspensionIndex(
        suspensionId
      );
    }

    return execution;
  } catch (error) {
    /**
     * Concurrent resolve from another device/process:
     * if another writer already committed the resolution, return the
     * durable winner rather than allowing a later click to overwrite it.
     */
    if (
      error instanceof
        StorageConflictError
    ) {
      const latest =
        await storage
          .loadExecution(
            indexed.executionId
          );

      if (
        latest &&
        latest.history
          .some(
            entry =>
              entry.kind ===
                "suspension_resolved" &&
              entry.suspensionId ===
                suspensionId
          )
      ) {
        return latest;
      }
    }

    throw error;
  }
}

export async function cancelSuspension(
  suspensionId: string,
  storage: Storage,
  reason = "cancelled"
): Promise<Execution> {
  const indexed =
    await storage.findSuspension(
      suspensionId
    );

  if (!indexed) {
    throw new Error(
      `Suspension not found: ${suspensionId}`
    );
  }

  const execution =
    await storage.loadExecution(
      indexed.executionId
    );

  if (!execution) {
    throw new Error(
      `Execution not found for suspension: ${suspensionId}`
    );
  }

  const resolved =
    execution.history.some(
      entry =>
        entry.kind ===
          "suspension_resolved" &&
        entry.suspensionId ===
          suspensionId
    );

  if (resolved) {
    return execution;
  }

  if (
    isSuspensionCancelled(
      execution.history,
      suspensionId
    )
  ) {
    return execution;
  }

  const expectedRevision =
    execution.revision ??
    0;

  execution.history.push({
    kind: "suspension_cancelled",
    suspensionId,
    cancelledAt: Date.now(),
    reason
  });

  try {
    if (
      storage
        .saveExecutionAndRemoveSuspension
    ) {
      await storage
        .saveExecutionAndRemoveSuspension(
          execution,
          suspensionId,
          expectedRevision
        );

      return execution;
    }

    await storage.saveExecution(
      execution,
      expectedRevision
    );

    await storage.removeSuspensionIndex(
      suspensionId
    );

    return execution;
  } catch (error) {
    /**
     * Cancellation races with manual/event/timer resolution. Exactly one
     * durable state transition may win. A stale writer reloads that winner
     * instead of appending a contradictory terminal event.
     */
    if (
      error instanceof
        StorageConflictError
    ) {
      const latest =
        await storage
          .loadExecution(
            indexed.executionId
          );

      if (
        latest &&
        latest.history
          .some(
            entry =>
              (
                entry.kind ===
                  "suspension_resolved" ||
                entry.kind ===
                  "suspension_cancelled"
              ) &&
              entry.suspensionId ===
                suspensionId
          )
      ) {
        return latest;
      }
    }

    throw error;
  }
}
export class WorkflowVersionMismatchError
  extends Error {
  constructor(
    readonly executionId:
      string,
    readonly workflowName:
      string,
    readonly pinnedVersion:
      string,
    readonly requestedVersion:
      string
  ) {
    super(
      `Execution ${executionId} is pinned to workflow ` +
      `"${workflowName}" version "${pinnedVersion}", ` +
      `but version "${requestedVersion}" was supplied.`
    );

    this.name =
      "WorkflowVersionMismatchError";
  }
}
