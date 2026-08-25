# MCP-first Multi-Runtime Agent

UAIR uses MCP as the existing interoperability boundary instead of defining a
new federation protocol. One Agent may connect to a **stdio local Runtime** for
personal Workflows and a **Streamable HTTP remote Runtime** for company
Workflows. Each Runtime remains an independent trust, durability and deployment
boundary.

```text
one Agent
├─ personal → MCP stdio → local UAIR Runtime → personal Storage
└─ company  → MCP HTTP  → company UAIR Runtime → company Storage
```

## Install and run the reference

```bash
npm install
npm run build
node scripts/check-multi-runtime-mcp.mjs
```

The check starts a local child process and a loopback company HTTP process,
invokes both, disconnects and restarts clients and servers, then proves that
the old company Execution handle is still readable.

## Publish explicitly

Only an **explicit Workflow publication** becomes an MCP tool:

```ts
const host = createMcpRuntimeHost({
  storage,
  invocations,
  authorize,
  workflows: [
    publishWorkflow({
      name: "leave.request",
      description: "Submit leave",
      inputSchema: leaveSchema,
      workflow: requestLeave
    })
  ]
});
```

The public tool name is not the durable Workflow ID. Renaming a tool therefore
does not silently rewrite existing Execution identity.

## Connect one Agent

Use an explicit process allowlist for stdio and an explicit network policy for
HTTP. Merge sources using qualified capability IDs:

```ts
const capabilities = await createMcpCapabilitySet({ personal, company });

await capabilities.get("personal:reminder.create")?.invoke(input);
await capabilities.get("company:leave.request")?.invoke(input);
```

The qualification prevents two servers' `calendar.create` tools from
colliding. It is an Agent-side catalog convention, not a new wire protocol.

## Authentication and authorization

A production HTTP deployment is an **OAuth protected resource**. OAuth/OIDC
middleware validates the token before MCP dispatch and supplies a Principal to
`resolvePrincipal`. The bearer token must not enter Workflow input, Component
calls, durable History or Agent state.

The Runtime authorizes every `discover`, `start`, `read`, `resolve` and
`cancel` operation. Listing a tool is not permission to invoke it forever.
The Runtime Host also validates the published JSON Schema and binds every
created Execution to the authenticated tenant/principal access scope. Knowing
an Execution handle never bypasses that binding.

## State and failure boundaries

The Agent stores only opaque `{ source, executionId, workflowId, status }`
handles. **remote History remains remote**. Disconnecting an Agent does not
cancel a company Execution, and a company outage does not stop the personal
stdio Runtime.

`WorkerDirectory` performs intra-Runtime deployment routing. It is not
cross-Runtime discovery and must not become a global service registry.

MCP client calls automatically reuse the Component `effectId` as the reserved
invocation idempotency key. Retries of one durable effect therefore reuse one
remote Execution, while distinct Component effects cannot be collapsed by a
static connection-level key.

## Tasks and other protocols

SDK 2.0.0 does not expose the current negotiated server runtime for MCP Tasks;
UAIR therefore uses the **MCP Tasks fallback**: structured
`uair.execution` handles plus `uair.execution.get`,
`uair.execution.cancel` and `uair.interaction.resolve`. The package contains a
lossy status mapping for a future current-revision Tasks seam, but does not
advertise the legacy 2025-11-25 Tasks vocabulary.

**A2A is optional and outside Core**. It may be added at a higher Agent-to-Agent
boundary when an actual multi-agent product requires it; ordinary Runtime
interoperability does not depend on it.
