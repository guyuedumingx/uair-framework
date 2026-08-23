import {
  McpServer
} from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  ServerContext,
  Tool
} from "@modelcontextprotocol/server";

import type {
  McpRuntimeHost
} from "./runtime-host.js";
import type {
  McpExecutionHandle,
  McpRuntimePrincipal
} from "./runtime-types.js";

const FALLBACK_TOOLS: Tool[] = [
  {
    name: "uair.execution.get",
    description: "Read a UAIR execution handle",
    inputSchema: {
      type: "object",
      required: ["executionId"],
      properties: { executionId: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    name: "uair.execution.cancel",
    description: "Cancel a suspended UAIR execution",
    inputSchema: {
      type: "object",
      required: ["executionId"],
      properties: { executionId: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    name: "uair.interaction.resolve",
    description: "Resolve a pending UAIR interaction",
    inputSchema: {
      type: "object",
      required: ["interactionId", "value"],
      properties: {
        interactionId: { type: "string" },
        value: {}
      },
      additionalProperties: false
    }
  }
];

function result(
  handle: McpExecutionHandle
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(handle)
      }
    ],
    structuredContent: handle
  };
}

function errorResult(
  error: unknown
): CallToolResult {
  const message = error instanceof Error
    ? error.message
    : "Unknown MCP Runtime error";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message
      }
    ]
  };
}

function stringArgument(
  args: Record<string, unknown>,
  name: string
) {
  const value = args[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`MCP tool argument "${name}" must be a non-empty string`);
  }
  return value;
}

export function createMcpRuntimeServer(
  options: {
    name: string;
    version: string;
    host: McpRuntimeHost;
    resolvePrincipal(
      context: ServerContext
    ): Promise<McpRuntimePrincipal> | McpRuntimePrincipal;
  }
) {
  const server = new McpServer(
    {
      name: options.name,
      version: options.version
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.server.setRequestHandler(
    "tools/list",
    async (_request, context) => {
      const principal = await options.resolvePrincipal(context);
      const workflows = await options.host.listTools(principal);
      return {
        tools: [
          ...workflows.map(tool => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: {
              ...tool.inputSchema,
              type: "object" as const
            },
            ...(tool.outputSchema
              ? {
                  outputSchema: {
                    ...tool.outputSchema,
                    type: "object" as const
                  }
                }
              : {})
          } satisfies Tool)),
          ...FALLBACK_TOOLS
        ]
      };
    }
  );

  server.server.setRequestHandler(
    "tools/call",
    async (request, context) => {
      try {
        const principal = await options.resolvePrincipal(context);
        const args = request.params.arguments ?? {};
        let handle: McpExecutionHandle;

        if (request.params.name === "uair.execution.get") {
          handle = await options.host.read({
            principal,
            executionId: stringArgument(args, "executionId")
          });
        } else if (request.params.name === "uair.execution.cancel") {
          handle = await options.host.cancel({
            principal,
            executionId: stringArgument(args, "executionId")
          });
        } else if (request.params.name === "uair.interaction.resolve") {
          handle = await options.host.resolve({
            principal,
            interactionId: stringArgument(args, "interactionId"),
            value: args.value
          });
        } else {
          const idempotencyKey = context.mcpReq._meta?.[
            "io.uair/idempotency-key"
          ];
          if (typeof idempotencyKey !== "string" || !idempotencyKey) {
            throw new Error(
              "MCP Workflow start requires io.uair/idempotency-key metadata"
            );
          }
          handle = await options.host.start({
            principal,
            toolName: request.params.name,
            input: args,
            idempotencyKey
          });
        }

        return server.server.projectCallToolResult(
          result(handle),
          undefined
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}
