import {
  createHash
} from "node:crypto";
import type {
  ErrorObject,
  ValidateFunction
} from "ajv";
import {
  Ajv
} from "ajv";
import {
  resume,
  run
} from "@uair/core";
import {
  cancelSuspension
} from "@uair/core/runtime";
import type {
  Storage
} from "@uair/core/runtime";
import type {
  Execution
} from "@uair/core";

import type {
  McpInvocationIdentity,
  McpInvocationStore
} from "./invocation-store.js";
import type {
  McpExecutionHandle,
  McpRuntimeAuthorizer,
  McpRuntimePrincipal,
  PublishedWorkflow
} from "./runtime-types.js";

export type McpPublishedTool = Omit<
  PublishedWorkflow,
  "workflow"
>;

export type StartMcpWorkflowInput = {
  principal: McpRuntimePrincipal;
  toolName: string;
  input: unknown;
  idempotencyKey: string;
};

export type ReadMcpExecutionInput = {
  principal: McpRuntimePrincipal;
  executionId: string;
};

export type ResolveMcpInteractionInput = {
  principal: McpRuntimePrincipal;
  interactionId: string;
  value: unknown;
};

export type CancelMcpExecutionInput = {
  principal: McpRuntimePrincipal;
  executionId: string;
};

type InteractionResolver = {
  resolve(input: {
    interactionId: string;
    actor: string;
    value: unknown;
  }): Promise<Execution>;
};

export type McpRuntimeHost = {
  listTools(
    principal: McpRuntimePrincipal
  ): Promise<McpPublishedTool[]>;
  start(
    input: StartMcpWorkflowInput
  ): Promise<McpExecutionHandle>;
  read(
    input: ReadMcpExecutionInput
  ): Promise<McpExecutionHandle>;
  resolve(
    input: ResolveMcpInteractionInput
  ): Promise<McpExecutionHandle>;
  cancel(
    input: CancelMcpExecutionInput
  ): Promise<McpExecutionHandle>;
};

export type McpRuntimeHostOptions = {
  storage: Storage;
  workflows: PublishedWorkflow<any, any>[];
  invocations: McpInvocationStore;
  authorize: McpRuntimeAuthorizer;
  interactions?: InteractionResolver;
  claimLeaseMs?: number;
  claimPollMs?: number;
  claimWaitMs?: number;
  now?: () => number;
  accessScopeKey?:
    (
      principal: McpRuntimePrincipal
    ) => string;
};

export class McpRuntimeAuthorizationError
extends Error {
  constructor() {
    super("MCP Runtime authorization denied");
    this.name = "McpRuntimeAuthorizationError";
  }
}

export class McpExecutionAccessDeniedError
extends Error {
  constructor() {
    super("MCP Execution access denied");
    this.name = "McpExecutionAccessDeniedError";
  }
}

export class McpWorkflowInputValidationError
extends Error {
  constructor(
    toolName: string,
    errors:
      ErrorObject[] | null | undefined
  ) {
    const details = errors
      ?.map(error =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`
      )
      .join("; ") ??
      "input is invalid";
    super(
      `MCP Workflow "${toolName}" input validation failed: ${details}`
    );
    this.name = "McpWorkflowInputValidationError";
  }
}

export class McpInvocationInProgressError
extends Error {
  constructor() {
    super(
      "MCP invocation is being created; retry with the same idempotency key"
    );
    this.name = "McpInvocationInProgressError";
  }
}

export class McpExecutionNotCancellableError
extends Error {
  constructor(
    executionId: string
  ) {
    super(
      `MCP Execution is not currently cancellable: ${executionId}`
    );
    this.name = "McpExecutionNotCancellableError";
  }
}

function principalKey(
  principal: McpRuntimePrincipal
) {
  return JSON.stringify([
    principal.tenantId ?? null,
    principal.id
  ]);
}

function defaultAccessScopeKey(
  principal: McpRuntimePrincipal
) {
  return principal.tenantId
    ? JSON.stringify([
        "tenant",
        principal.tenantId
      ])
    : JSON.stringify([
        "principal",
        principal.id
      ]);
}

function canonicalJson(
  value: unknown,
  seen = new Set<object>()
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        "MCP Workflow input must contain only finite JSON numbers"
      );
    }
    return value;
  }

  if (typeof value === "undefined") {
    throw new Error(
      "MCP Workflow input must not contain undefined"
    );
  }

  if (
    typeof value !== "object"
  ) {
    throw new Error(
      "MCP Workflow input must be JSON serializable"
    );
  }

  if (seen.has(value)) {
    throw new Error(
      "MCP Workflow input must not contain cycles"
    );
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map(item =>
        canonicalJson(item, seen)
      );
    }

    const record =
      value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map(key => [
          key,
          canonicalJson(
            record[key],
            seen
          )
        ])
    );
  } finally {
    seen.delete(value);
  }
}

function requestHash(
  toolName: string,
  input: unknown
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        toolName,
        canonicalJson(input)
      ])
    )
    .digest("hex");
}

function projectExecution(
  execution: Execution
): McpExecutionHandle {
  const cancelled = execution.history.some(
    entry => entry.kind === "suspension_cancelled"
  );
  const status = cancelled
    ? "cancelled"
    : execution.status;

  return {
    kind: "uair.execution",
    executionId: execution.id,
    workflowId: execution.workflow,
    workflowVersion: execution.workflowVersion ?? "1",
    status,
    ...(status === "completed"
      ? { result: execution.result }
      : {})
  };
}

function delay(
  milliseconds: number
) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

export function createMcpRuntimeHost(
  options: McpRuntimeHostOptions
): McpRuntimeHost {
  const workflows = new Map<
    string,
    PublishedWorkflow<any, any>
  >();
  const validators = new Map<
    string,
    ValidateFunction
  >();
  const ajv = new Ajv({
    allErrors: true,
    strict: false
  });
  const now = options.now ?? Date.now;
  const claimLeaseMs =
    options.claimLeaseMs ??
    120_000;
  const claimPollMs =
    options.claimPollMs ??
    10;
  const claimWaitMs =
    options.claimWaitMs ??
    5_000;
  const accessScopeKey =
    options.accessScopeKey ??
    defaultAccessScopeKey;

  if (
    claimLeaseMs <= 0 ||
    claimPollMs <= 0 ||
    claimWaitMs <= 0
  ) {
    throw new Error(
      "MCP Runtime claim timing options must be positive"
    );
  }

  for (const published of options.workflows) {
    if (workflows.has(published.name)) {
      throw new Error(
        `Duplicate published MCP tool name: ${published.name}`
      );
    }
    workflows.set(published.name, published);
    validators.set(
      published.name,
      ajv.compile(
        published.inputSchema
      )
    );
  }

  const authorize = async (
    input: Parameters<McpRuntimeAuthorizer>[0]
  ) => {
    if (!await options.authorize(input)) {
      throw new McpRuntimeAuthorizationError();
    }
  };

  const load = async (
    executionId: string
  ) => {
    const execution = await options.storage.loadExecution(
      executionId
    );
    if (!execution) {
      throw new Error(
        `MCP Execution not found: ${executionId}`
      );
    }
    return execution;
  };

  const assertExecutionAccess = async (
    principal: McpRuntimePrincipal,
    executionId: string
  ) => {
    const binding =
      await options.invocations
        .findByExecutionId(
          executionId
        );

    if (
      !binding ||
      binding.accessScopeKey !==
        accessScopeKey(principal)
    ) {
      throw new McpExecutionAccessDeniedError();
    }
  };

  const claimStorage = (
    identity: McpInvocationIdentity,
    leaseToken: string,
    onBound:
      (executionId: string) => void
  ): Storage =>
    new Proxy(
      options.storage,
      {
        get(target, property) {
          if (property === "saveExecution") {
            return async (
              execution: Execution,
              expectedRevision?: number
            ) => {
              await options.invocations
                .bindExecution(
                  identity,
                  leaseToken,
                  execution.id,
                  now(),
                  claimLeaseMs
                );
              onBound(execution.id);
              return target.saveExecution(
                execution,
                expectedRevision
              );
            };
          }

          const value = Reflect.get(
            target,
            property,
            target
          );
          return typeof value === "function"
            ? value.bind(target)
            : value;
        }
      }
    );

  const executeClaim = async (
    published: PublishedWorkflow<any, any>,
    identity: McpInvocationIdentity,
    input: unknown,
    leaseToken: string,
    existingExecutionId?: string
  ) => {
    let boundExecutionId =
      existingExecutionId;
    let renewal =
      Promise.resolve();
    const renewalInterval =
      Math.max(
        5,
        Math.floor(
          claimLeaseMs / 3
        )
      );
    const heartbeat = setInterval(
      () => {
        renewal = renewal
          .catch(() => undefined)
          .then(() =>
            options.invocations.renew(
              identity,
              leaseToken,
              now(),
              claimLeaseMs
            )
          )
          .then(() => undefined);
      },
      renewalInterval
    );
    heartbeat.unref();

    const stopHeartbeat = async () => {
      clearInterval(heartbeat);
      await renewal.catch(
        () => undefined
      );
    };

    try {
      let execution:
        Execution | null = null;

      if (existingExecutionId) {
        execution =
          await options.storage
            .loadExecution(
              existingExecutionId
            );
      }

      if (execution) {
        if (
          execution.status ===
            "running"
        ) {
          execution = await resume(
            published.workflow,
            execution.id,
            options.storage
          );
        }
      } else {
        execution = await run(
          published.workflow,
          input,
          claimStorage(
            identity,
            leaseToken,
            executionId => {
              boundExecutionId =
                executionId;
            }
          )
        );
      }

      await stopHeartbeat();
      await options.invocations.complete(
        identity,
        leaseToken,
        now()
      );
      return projectExecution(execution);
    } catch (error) {
      await stopHeartbeat();

      try {
        const persisted =
          boundExecutionId
            ? await options.storage
                .loadExecution(
                  boundExecutionId
                )
            : null;

        if (persisted) {
          await options.invocations.complete(
            identity,
            leaseToken,
            now()
          );
        } else {
          await options.invocations.release(
            identity,
            leaseToken,
            now()
          );
        }
      } catch {
        // A later lease owner now controls recovery. Preserve the
        // original Workflow/storage failure for this caller.
      }

      throw error;
    }
  };

  return {
    async listTools(principal) {
      await authorize({
        principal,
        action: "discover"
      });
      return Array.from(workflows.values()).map(
        ({ workflow: _workflow, ...tool }) => tool
      );
    },

    async start(input) {
      await authorize({
        principal: input.principal,
        action: "start",
        toolName: input.toolName
      });
      const published = workflows.get(input.toolName);
      if (!published) {
        throw new Error(
          `Published MCP Workflow not found: ${input.toolName}`
        );
      }
      if (!input.idempotencyKey.trim()) {
        throw new Error(
          "MCP Workflow start requires a non-empty idempotency key"
        );
      }
      const validate =
        validators.get(input.toolName);
      if (
        !validate ||
        !validate(input.input)
      ) {
        throw new McpWorkflowInputValidationError(
          input.toolName,
          validate?.errors
        );
      }

      const identity = {
        principalKey:
          principalKey(
            input.principal
          ),
        toolName: input.toolName,
        idempotencyKey:
          input.idempotencyKey
      };
      const claimDeadline =
        Date.now() + claimWaitMs;

      while (true) {
        const claim =
          await options.invocations.claim(
            identity,
            {
              accessScopeKey:
                accessScopeKey(
                  input.principal
                ),
              requestHash:
                requestHash(
                  input.toolName,
                  input.input
                ),
              now: now(),
              leaseDurationMs:
                claimLeaseMs
            }
          );

        if (claim.acquired) {
          return executeClaim(
            published,
            identity,
            input.input,
            claim.leaseToken,
            claim.record.executionId
          );
        }

        if (claim.record.executionId) {
          const execution =
            await options.storage
              .loadExecution(
                claim.record.executionId
              );
          if (execution) {
            return projectExecution(
              execution
            );
          }
        }

        if (
          claim.record.status ===
            "complete"
        ) {
          throw new Error(
            "Completed MCP invocation has no durable Execution"
          );
        }

        if (Date.now() >= claimDeadline) {
          throw new McpInvocationInProgressError();
        }

        await delay(claimPollMs);
      }
    },

    async read(input) {
      await authorize({
        principal: input.principal,
        action: "read",
        executionId: input.executionId
      });
      await assertExecutionAccess(
        input.principal,
        input.executionId
      );
      return projectExecution(
        await load(input.executionId)
      );
    },

    async resolve(input) {
      await authorize({
        principal: input.principal,
        action: "resolve",
        interactionId: input.interactionId
      });
      if (!options.interactions) {
        throw new Error(
          "MCP Runtime interaction resolution is not configured"
        );
      }
      const pending =
        await options.storage.findSuspension(
          input.interactionId
        );
      if (!pending) {
        throw new McpExecutionAccessDeniedError();
      }
      await assertExecutionAccess(
        input.principal,
        pending.executionId
      );
      return projectExecution(
        await options.interactions.resolve({
          interactionId: input.interactionId,
          actor: input.principal.id,
          value: input.value
        })
      );
    },

    async cancel(input) {
      await authorize({
        principal: input.principal,
        action: "cancel",
        executionId: input.executionId
      });
      await assertExecutionAccess(
        input.principal,
        input.executionId
      );
      const execution = await load(input.executionId);
      if (execution.status !== "suspended") {
        throw new McpExecutionNotCancellableError(
          input.executionId
        );
      }
      const terminal = new Set(
        execution.history
          .filter(entry =>
            entry.kind === "suspension_resolved" ||
            entry.kind === "suspension_cancelled"
          )
          .map(entry => entry.suspensionId)
      );
      const suspension = [...execution.history]
        .reverse()
        .find(entry =>
          entry.kind === "suspension_created" &&
          !terminal.has(entry.suspensionId)
        );
      if (!suspension || suspension.kind !== "suspension_created") {
        throw new McpExecutionNotCancellableError(
          input.executionId
        );
      }
      return projectExecution(
        await cancelSuspension(
          suspension.suspensionId,
          options.storage,
          `cancelled by ${input.principal.id}`
        )
      );
    }
  };
}
