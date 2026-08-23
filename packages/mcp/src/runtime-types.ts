import type {
  WorkflowDefinition
} from "@uair/core";

export type McpRuntimePrincipal = {
  id: string;
  tenantId?: string;
  claims?: Record<string, unknown>;
};

export type McpRuntimeAction =
  | "discover"
  | "start"
  | "read"
  | "resolve"
  | "cancel";

export type McpRuntimeAuthorizationInput = {
  principal: McpRuntimePrincipal;
  action: McpRuntimeAction;
  toolName?: string;
  executionId?: string;
  interactionId?: string;
};

export type McpRuntimeAuthorizer =
  (
    input: McpRuntimeAuthorizationInput
  ) => boolean | Promise<boolean>;

export type PublishedWorkflow<
  I = unknown,
  O = unknown
> = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  workflow: WorkflowDefinition<I, O>;
};

export type McpExecutionHandle = {
  kind: "uair.execution";
  executionId: string;
  workflowId: string;
  workflowVersion: string;
  status:
    | "running"
    | "suspended"
    | "completed"
    | "failed"
    | "cancelled";
  result?: unknown;
};

export function publishWorkflow<
  I,
  O
>(
  input: PublishedWorkflow<I, O>
) {
  if (
    !input.name.trim()
  ) {
    throw new Error(
      "publishWorkflow requires a non-empty MCP tool name"
    );
  }

  return input;
}
