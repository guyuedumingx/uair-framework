import {
  CapabilitySet
} from "@uair/capability";
import type {
  Capability
} from "@uair/capability";

import type {
  McpServerAdapter
} from "./client.js";

const SOURCE_NAME =
  /^[A-Za-z0-9._-]+$/;

export async function createMcpCapabilitySet(
  sources: Record<string, McpServerAdapter>
) {
  const entries = Object.entries(sources);

  for (const [sourceName] of entries) {
    if (!SOURCE_NAME.test(sourceName)) {
      throw new Error(
        `Invalid MCP source name: ${sourceName}`
      );
    }
  }

  const capabilities: Capability[] = [];
  const ids = new Set<string>();

  for (const [sourceName, adapter] of entries) {
    const tools = await adapter.listTools();

    for (const tool of tools) {
      const id = `${sourceName}:${tool.name}`;

      if (ids.has(id)) {
        throw new Error(
          `Duplicate qualified MCP capability ID: ${id}`
        );
      }

      ids.add(id);
      capabilities.push({
        id,
        kind: "tool",
        description: tool.description,
        inputSchema: tool.inputSchema,
        metadata: {
          source: sourceName,
          remoteToolName: tool.name
        },
        invoke: adapter.tool(tool.name)
      });
    }
  }

  return new CapabilitySet(capabilities);
}
