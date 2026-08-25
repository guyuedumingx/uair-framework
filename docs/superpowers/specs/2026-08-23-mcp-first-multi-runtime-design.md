# MCP-first Multi-Runtime Design

Date: 2026-08-23

## Status

Approved direction. This document defines the minimum design to validate before
implementation planning.

## Goal

A person talks to one AI Agent and can use reliable Workflows hosted by
different autonomous UAIR Runtime hosts. For example:

```text
"Request leave tomorrow afternoon"
→ company MCP server
→ company UAIR Runtime
→ company PostgreSQL

"Remind me to close the window at 20:00"
→ local MCP stdio server
→ personal UAIR Runtime
→ local SQLite
```

The user experiences one conversational surface. Each Runtime retains its own
execution, data, authorization, deployment and failure boundary.

## Design principles

1. Core stays unchanged.
2. Reuse MCP instead of defining a UAIR federation protocol.
3. Reuse OAuth/OIDC through MCP instead of defining UAIR identity federation.
4. A Workflow is not an Agent and does not require A2A.
5. A remote tool call is not authorization; the target host authorizes every
   discovery, invocation, read, resolve and cancel operation.
6. Workflow durable identity remains local to its Runtime contract.
7. Remote History remains at the owning Runtime.
8. Long-running calls must remain findable after acknowledgement.
9. Task/Execution delivery and retries are at-least-once; invocation creation
   must be idempotent.
10. Hosts explicitly expose selected Workflows. Nothing is published by
    default.

## Non-goals

The first implementation does not add:

```text
UAIR federation protocol
global Runtime registry
global uair:// URI namespace
central control plane
public relay or peer-to-peer networking
A2A adapter
new identity-provider abstraction
automatic publication of all Workflows
cross-Runtime Execution migration
cross-Runtime History replication
```

## Architecture

```text
                       Personal AI Agent
                 MCP tool discovery and selection
                          /          \
                  MCP stdio          MCP Streamable HTTP
                     |                       |
              Local MCP host          Company MCP host
                     |                       |
              Local UAIR Runtime      Company UAIR Runtime
              SQLite + OS effects     PostgreSQL + business APIs
```

There is no parent Runtime above the two hosts. The common layer is the UAIR
execution model plus the MCP connection contract.

## Existing contracts reused

### UAIR Runtime

UAIR Core remains responsible for:

```text
Workflow
Component/Effect
Execution/History
Suspension
replay
version/deployment identity
storage correctness
```

Internal cluster routing remains an implementation detail of one Runtime
administrative domain. `WorkerDirectory`, `DeploymentRouter` and
`ReliableWorkerQueue` are not used for cross-Runtime selection.

### UAIR Capability and Agent

`CapabilitySet` remains the Agent-facing catalog. Capability sets obtained from
multiple configured MCP servers are merged while preserving their source name.

The Agent may select and propose a tool call. It does not become the authority
for the remote Execution or its data.

### UAIR Security and Interaction

Invocation-time authorization remains mandatory. Existing Interaction
contracts remain the Runtime representation of durable human input. MCP is the
transport projection; it does not redefine Interaction semantics.

### MCP

Use standard MCP operations and transports:

```text
tools/list            capability discovery
tools/call            Workflow invocation
stdio                 local host connection
Streamable HTTP       remote company connection
OAuth/OIDC            remote authorization
Tasks extension       optional long-running task projection
```

## Minimal public surface

The only new architectural capability is the server side of `@uair/mcp`.

Conceptual host API:

```ts
serveMcp({
  runtime,
  tools: {
    "leave.request": leaveRequest
  },
  transport
});
```

The exact TypeScript API will be finalized in the implementation plan. It must
not add Runtime semantics and must not require a new package.

Each exported Workflow becomes an MCP Tool with:

```text
name
description
inputSchema
optional outputSchema
explicit host authorization policy
task support metadata
```

The public tool name is presentation/integration metadata. It does not rename
the Workflow durable ID.

## Multiple Runtime discovery

The first implementation uses explicit connection profiles rather than a
registry:

```ts
{
  personal: {
    transport: "stdio",
    command: "uair-mcp"
  },
  company: {
    transport: "http",
    url: "https://uair.example.com/mcp"
  }
}
```

The Agent calls `tools/list` on each configured server. Internally, tool
identity is qualified by its connection name to prevent collisions:

```text
personal:reminder.create
company:leave.request
```

The qualifier is Agent-host routing metadata, not part of UAIR durable
identity and not required to appear in user-facing conversation.

## Invocation lifecycle

### Immediate operation

An operation that completes during `tools/call` returns a normal MCP
`CallToolResult`.

### Long-running operation

When both sides negotiate MCP Tasks support:

```text
tools/call
→ durable UAIR Execution created
→ MCP Task handle returned
→ tasks/get for status
→ tasks/update for requested input when supported
→ tasks/cancel for cooperative cancellation
→ terminal result
```

The server must not acknowledge a task until the UAIR Execution is durably
findable.

The MCP Task ID is an opaque external handle. The host keeps its mapping to the
UAIR Execution ID and binds access to the authenticated context.

### Compatibility fallback

MCP Tasks is an optional extension and client support varies. When it was not
negotiated, a long-running Workflow returns structured content containing an
opaque Execution handle. Three ordinary MCP tools provide the minimum fallback:

```text
uair.execution.get
uair.execution.cancel
uair.interaction.resolve
```

The fallback is a tool schema convention, not a new network transport or
federation protocol. A later Tasks-capable client can use the standard
projection without changing Core or stored Executions.

## State mapping

The MCP projection is deliberately lossy and does not expose complete History.

```text
UAIR running       → MCP working
UAIR suspended     → MCP input_required when input belongs to this caller
UAIR completed     → MCP completed
UAIR failed        → MCP failed
UAIR cancelled     → MCP cancelled
```

A Suspension that belongs to another actor, such as a manager approval, does
not grant the requesting user permission to resolve it. The caller receives a
safe waiting status until the owning Runtime authorizes more detail.

## Authorization

### Local stdio

The local process runs under the current OS user. The host uses an explicit
stdio command allowlist and does not apply MCP HTTP OAuth semantics.

### Remote HTTP

The company MCP server acts as an OAuth protected resource. The Agent-side MCP
client follows protected-resource and authorization-server discovery, performs
the user login flow, and requests a token for the exact MCP resource.

The company host establishes tenant and Principal before reaching UAIR. It
must enforce authorization separately for:

```text
tools/list
tools/call
task/execution status
interaction read/resolve
cancellation
```

Token passthrough to downstream systems is forbidden. Downstream credentials
remain server-side Capability/Component configuration.

## Idempotency and failures

Network timeout does not mean the remote Workflow was not created. The client
must reuse an invocation idempotency key when retrying creation. The server
must return the previously created Task/Execution handle for the same
authorized caller, tool and key.

```text
send tools/call
→ server durably creates Execution
→ response is lost
→ client retries with the same key
→ server returns the original handle
```

Disconnecting an MCP transport does not cancel the UAIR Execution. Cancellation
is explicit and cooperative. The Runtime remains the source of terminal truth.

If a Runtime is unavailable, the Agent reports that specific capability source
as unavailable. Other configured sources remain usable. Local Workflows can
continue while the company server is offline.

## Data boundary

The Agent host stores only what it needs to resume the conversation:

```text
connection profile name
opaque task/execution handle
safe status summary
last observed update
```

Remote input, result, Interaction payload and History remain at the target
Runtime unless its policy explicitly returns them. Knowing a handle is never
authorization.

## A2A boundary

A2A is not part of the first implementation. It becomes relevant only when one
autonomous Agent delegates an open-ended task to another autonomous Agent.
Deterministic Workflow invocation remains MCP. A future A2A adapter must remain
outside Core and may itself call UAIR Workflows.

## Required implementation slices

1. Add an MCP server adapter to `@uair/mcp` that explicitly exposes selected
   Workflows as tools.
2. Add a local stdio reference host backed by SQLite.
3. Add a Streamable HTTP reference host with an injectable authentication and
   authorization boundary.
4. Preserve MCP server origin while merging multiple Capability sets for one
   Agent.
5. Map durable Execution creation and status to negotiated MCP Tasks where the
   installed SDK supports it.
6. Implement the three-tool Execution-handle fallback.
7. Demonstrate one conversation invoking a local reminder and a remote leave
   Workflow without sharing Storage or History.

## Acceptance criteria

The design is proven only when an end-to-end test demonstrates:

1. One Agent discovers tools from one stdio and one HTTP MCP server.
2. Identically named tools do not collide.
3. A local reminder runs with local SQLite while the remote server is offline.
4. A company leave request authenticates and runs in the company Runtime.
5. Unauthorized discovery, start, read, resolve and cancel fail closed.
6. A lost invocation response followed by a retry returns one Execution.
7. Agent restart can resume observation using a stored opaque handle.
8. A manager-only Suspension cannot be resolved by the requesting employee.
9. Transport disconnect does not cancel either Execution.
10. No remote History is copied into the personal Runtime.
11. Existing deterministic replay, package boundaries and Core API gates pass.
12. The same scenario works through the fallback when MCP Tasks is disabled.

## Design consequences

This design introduces no new Core concept and no new top-level package. Its
main risk is MCP Tasks ecosystem maturity, contained by capability negotiation
and the ordinary-tool fallback. If later evidence proves the fallback contract
is broadly reused outside MCP, it may be extracted then; it is not generalized
in advance.
