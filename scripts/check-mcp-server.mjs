import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { workflow } from "../packages/core/dist/index.js";
import { JsonFileStorage } from "../packages/core/dist/runtime-api.js";
import {
  createMcpRuntimeHost,
  createMcpRuntimeServer,
  InMemoryMcpInvocationStore,
  publishWorkflow
} from "../packages/mcp/dist/index.js";

const dir = await mkdtemp(join(tmpdir(), "uair-mcp-server-"));
const leave = workflow("hr.leave.request", async input => ({ accepted: input.days > 0 }));
const host = createMcpRuntimeHost({
  storage: new JsonFileStorage(join(dir, "executions")),
  invocations: new InMemoryMcpInvocationStore(),
  workflows: [publishWorkflow({
    name: "leave.request",
    description: "Request leave",
    inputSchema: {
      type: "object",
      required: ["days"],
      properties: { days: { type: "number" } },
      additionalProperties: false
    },
    workflow: leave
  })],
  authorize: ({ principal }) => principal.id === "employee-1"
});
const server = createMcpRuntimeServer({
  name: "uair-test",
  version: "0.68.0",
  host,
  resolvePrincipal: context => ({
    id: context.mcpReq._meta?.["io.uair/test-principal"] ?? "anonymous"
  })
});
const client = new Client({ name: "uair-test-client", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

const metadata = { "io.uair/test-principal": "employee-1" };
const listed = await client.listTools({ _meta: metadata });
assert.deepEqual(listed.tools.map(tool => tool.name), [
  "leave.request",
  "uair.execution.get",
  "uair.execution.cancel",
  "uair.interaction.resolve"
]);
const called = await client.callTool({
  name: "leave.request",
  arguments: { days: 2 },
  _meta: {
    ...metadata,
    "io.uair/idempotency-key": "leave-100"
  }
});
assert.equal(called.structuredContent.kind, "uair.execution");
assert.equal(called.structuredContent.status, "completed");
assert.deepEqual(JSON.parse(called.content[0].text), called.structuredContent);

for (const invalidArguments of [
  {},
  { days: "two" },
  { days: 2, unexpected: true }
]) {
  const invalid = await client.callTool({
    name: "leave.request",
    arguments: invalidArguments,
    _meta: {
      ...metadata,
      "io.uair/idempotency-key": `invalid-${JSON.stringify(invalidArguments)}`
    }
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /input validation failed/);
}

await client.close();
await server.close();
console.log("UAIR MCP server protocol: PASS");
