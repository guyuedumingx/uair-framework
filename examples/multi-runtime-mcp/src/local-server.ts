import {
  StdioServerTransport
} from "@modelcontextprotocol/server/stdio";
import {
  JsonFileStorage
} from "@uair/core/runtime";
import {
  JsonFileMcpInvocationStore,
  createMcpRuntimeHost,
  createMcpRuntimeServer,
  publishWorkflow
} from "@uair/mcp";
import {
  join
} from "node:path";
import {
  createReminder
} from "./workflows.js";

const dataDir = process.env.UAIR_DATA_DIR;
const principalId = process.env.UAIR_PRINCIPAL_ID ?? "local-user";
if (!dataDir) throw new Error("UAIR_DATA_DIR is required");

const host = createMcpRuntimeHost({
  storage: new JsonFileStorage(join(dataDir, "executions")),
  invocations: new JsonFileMcpInvocationStore(join(dataDir, "invocations")),
  workflows: [publishWorkflow({
    name: "reminder.create",
    description: "Create a personal reminder",
    inputSchema: {
      type: "object",
      required: ["at", "message"],
      properties: {
        at: { type: "string" },
        message: { type: "string" }
      },
      additionalProperties: false
    },
    workflow: createReminder
  })],
  authorize: ({ principal }) => principal.id === principalId
});
const server = createMcpRuntimeServer({
  name: "uair-personal-runtime",
  version: "0.68.0",
  host,
  resolvePrincipal: () => ({ id: principalId })
});
await server.connect(new StdioServerTransport());
