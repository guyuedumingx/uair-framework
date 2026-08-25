import {
  createServer
} from "node:http";
import {
  join
} from "node:path";
import {
  randomUUID
} from "node:crypto";
import {
  NodeStreamableHTTPServerTransport,
  localhostHostValidation,
  localhostOriginValidation
} from "@modelcontextprotocol/node";
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
  requestLeave
} from "./workflows.js";

const dataDir = process.env.UAIR_DATA_DIR;
const token = process.env.UAIR_TEST_BEARER_TOKEN;
const requestedPort = Number(process.env.PORT ?? "0");
if (!dataDir || !token) throw new Error("UAIR_DATA_DIR and UAIR_TEST_BEARER_TOKEN are required");

const storage = new JsonFileStorage(join(dataDir, "executions"));
const host = createMcpRuntimeHost({
  storage,
  invocations: new JsonFileMcpInvocationStore(join(dataDir, "invocations")),
  workflows: [publishWorkflow({
    name: "leave.request",
    description: "Submit a company leave request",
    inputSchema: {
      type: "object",
      required: ["employeeId", "date"],
      properties: {
        employeeId: { const: "employee-1" },
        date: { type: "string" }
      },
      additionalProperties: false
    },
    workflow: requestLeave
  })],
  authorize: ({ principal }) => principal.id === "employee-1"
});
const mcpServer = createMcpRuntimeServer({
  name: "uair-company-runtime",
  version: "0.68.0",
  host,
  resolvePrincipal: context => {
    if (context.http?.authInfo?.token !== token) {
      throw new Error("Invalid company Principal context");
    }
    return { id: "employee-1", tenantId: "company" };
  }
});
const transport = new NodeStreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID()
});
await mcpServer.connect(transport);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();
const httpServer = createServer((request, response) => {
  if (!validateHost(request, response) || !validateOrigin(request, response)) return;
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  const authenticatedRequest = request as typeof request & {
    auth: {
      token: string;
      clientId: string;
      scopes: string[];
    };
  };
  authenticatedRequest.auth = {
    token,
    clientId: "uair-reference-agent",
    scopes: ["workflow:invoke"]
  };
  void transport.handleRequest(authenticatedRequest, response);
});
httpServer.listen(requestedPort, "127.0.0.1", () => {
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Company server address unavailable");
  process.stdout.write(`${JSON.stringify({ ready: true, port: address.port })}\n`);
});
const close = async () => {
  httpServer.close();
  await mcpServer.close();
};
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
