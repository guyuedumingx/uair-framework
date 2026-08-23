import {
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

export class McpRuntimeAuthorizationError
extends Error {
  constructor() {
    super("MCP Runtime authorization denied");
    this.name = "McpRuntimeAuthorizationError";
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
  return `${principal.tenantId ?? ""}:${principal.id}`;
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

export function createMcpRuntimeHost(
  options: {
    storage: Storage;
    workflows: PublishedWorkflow<any, any>[];
    invocations: McpInvocationStore;
    authorize: McpRuntimeAuthorizer;
    interactions?: InteractionResolver;
  }
): McpRuntimeHost {
  const workflows = new Map<
    string,
    PublishedWorkflow<any, any>
  >();

  for (const published of options.workflows) {
    if (workflows.has(published.name)) {
      throw new Error(
        `Duplicate published MCP tool name: ${published.name}`
      );
    }
    workflows.set(published.name, published);
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
      const identity = {
        principalKey: principalKey(input.principal),
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey
      };
      const existing = await options.invocations.find(identity);
      if (existing) {
        return projectExecution(
          await load(existing.executionId)
        );
      }
      const execution = await run(
        published.workflow,
        input.input,
        options.storage
      );
      const winner = await options.invocations.saveIfAbsent({
        ...identity,
        executionId: execution.id,
        createdAt: Date.now()
      });
      return projectExecution(
        winner.executionId === execution.id
          ? execution
          : await load(winner.executionId)
      );
    },

    async read(input) {
      await authorize({
        principal: input.principal,
        action: "read",
        executionId: input.executionId
      });
      return projectExecution(await load(input.executionId));
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
