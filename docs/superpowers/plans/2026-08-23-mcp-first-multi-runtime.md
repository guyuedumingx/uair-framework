# MCP-first Multi-Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one Agent discover and invoke explicitly published UAIR Workflows from a local stdio Runtime and a remote Streamable HTTP Runtime without changing Core or copying remote History.

**Architecture:** Extend the existing `@uair/mcp` package in both directions: retain its MCP-client-to-UAIR-Component adapter and add a UAIR-Workflow-to-MCP-server adapter. Map long-running Workflows to opaque Execution handles first, add negotiated MCP Tasks only after the fallback passes, and keep authentication as one host-supplied Principal resolver plus one invocation-time authorizer.

**Tech Stack:** TypeScript 5.9, Node.js 24, `@modelcontextprotocol/client` 2.0, `@modelcontextprotocol/server` 2.0, MCP stdio/Streamable HTTP, UAIR Core/Interaction/Security, SQLite, deterministic `.mjs` verification scripts.

---

## Scope and file map

The implementation remains one package plus one reference example.

```text
packages/mcp/src/client.ts
  Existing MCP client adapter moved without behavior changes.

packages/mcp/src/runtime-types.ts
  Published Workflow, caller context, authorization action and external handle contracts.

packages/mcp/src/invocation-store.ts
  Idempotency-key to Execution-handle mapping; in-memory and JSON-file references.

packages/mcp/src/runtime-host.ts
  Transport-independent Workflow start/status/resolve/cancel projection.

packages/mcp/src/server.ts
  Official MCP SDK registration and protocol-result conversion.

packages/mcp/src/multi-source.ts
  Merge MCP tools while qualifying collisions with their configured source.

packages/mcp/src/index.ts
  Stable public exports only.

scripts/check-mcp-runtime-host.mjs
  Deterministic host/idempotency/authorization/Interaction tests.

scripts/check-mcp-server.mjs
  Real MCP SDK in-memory and stdio protocol tests.

examples/multi-runtime-mcp/
  One local SQLite host, one independent company host, and one client conversation.

scripts/check-multi-runtime-mcp.mjs
  Cross-process stdio + HTTP acceptance harness.
```

Do not modify files under `packages/core/`. Do not add `@uair/federation`, a
global registry, a Runtime URI, an A2A adapter, or an identity-provider API.

### Task 1: Freeze the current MCP client behavior before splitting the file

**Files:**
- Create: `scripts/check-mcp-client.mjs`
- Create: `packages/mcp/src/client.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the client characterization check**

Create `scripts/check-mcp-client.mjs` with a fake `McpClientLike` that records
`listTools()` and `callTool()` requests. Assert all existing public behavior:

```js
import assert from "node:assert/strict";
import {
  McpToolError,
  mcp
} from "../packages/mcp/dist/index.js";

const calls = [];
const adapter = mcp("company", {
  async listTools() {
    return { tools: [{ name: "leave.request", inputSchema: { type: "object" } }] };
  },
  async callTool(request) {
    calls.push(request);
    if (request.name === "fail") return { isError: true, content: [] };
    return { structuredContent: { accepted: true } };
  }
});

assert.deepEqual((await adapter.listTools()).map(tool => tool.name), ["leave.request"]);
assert.deepEqual(await adapter.call("leave.request", { days: 1 }), {
  structuredContent: { accepted: true }
});
assert.deepEqual(calls, [{ name: "leave.request", arguments: { days: 1 } }]);
await assert.rejects(adapter.call("fail"), McpToolError);
console.log("UAIR MCP client characterization: PASS");
```

- [ ] **Step 2: Run the check against the existing implementation**

Run:

```bash
npm run build
node scripts/check-mcp-client.mjs
```

Expected: the workspace build and `UAIR MCP client characterization: PASS`.

- [ ] **Step 3: Move the existing client adapter without changing exports**

Move the current contents of `packages/mcp/src/index.ts` into
`packages/mcp/src/client.ts`. Replace `packages/mcp/src/index.ts` with explicit
exports:

```ts
export {
  McpConnectionDeniedError,
  McpServerAdapter,
  McpToolError,
  allowListedMcpStdioPolicy,
  connectMcpHttp,
  connectMcpStdio,
  defaultMcpHttpConnectionPolicy,
  mcp
} from "./client.js";

export type {
  DefaultMcpHttpPolicyOptions,
  McpAdapterOptions,
  McpCallResult,
  McpClientLike,
  McpHttpConnectionPolicy,
  McpStdioProcessPolicy,
  McpToolDefinition
} from "./client.js";
```

Add the script:

```json
"check:mcp-client": "node scripts/check-mcp-client.mjs"
```

- [ ] **Step 4: Verify the split is behavior-neutral**

Run:

```bash
npm run build
npm run check:mcp-client
npm run check:adapter-api
```

Expected: all three commands pass and the adapter API snapshot reports no
unreviewed removal.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/mcp/src scripts/check-mcp-client.mjs
git commit -m "refactor(mcp): isolate existing client adapter"
```

### Task 2: Define the minimum published-Workflow contract

**Files:**
- Create: `packages/mcp/src/runtime-types.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `scripts/check-mcp-runtime-types.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing public-contract check**

Create `scripts/check-mcp-runtime-types.mjs`:

```js
import assert from "node:assert/strict";
import { workflow } from "../packages/core/dist/index.js";
import { publishWorkflow } from "../packages/mcp/dist/index.js";

const leave = workflow("hr.leave.request", async input => ({ accepted: input.days > 0 }));
const published = publishWorkflow({
  name: "leave.request",
  description: "Request employee leave",
  inputSchema: {
    type: "object",
    required: ["days"],
    properties: { days: { type: "number", minimum: 0.5 } },
    additionalProperties: false
  },
  workflow: leave
});

assert.equal(published.name, "leave.request");
assert.equal(published.workflow.id, "hr.leave.request");
assert.throws(() => publishWorkflow({ ...published, name: "" }), /non-empty MCP tool name/);
console.log("UAIR MCP published Workflow contract: PASS");
```

- [ ] **Step 2: Run it and confirm the missing export**

Run:

```bash
npm run build
node scripts/check-mcp-runtime-types.mjs
```

Expected: FAIL because `publishWorkflow` is not exported.

- [ ] **Step 3: Add the transport-neutral contracts**

Create `packages/mcp/src/runtime-types.ts`:

```ts
import type { WorkflowDefinition } from "@uair/core";

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
  (input: McpRuntimeAuthorizationInput) => boolean | Promise<boolean>;

export type PublishedWorkflow<I = unknown, O = unknown> = {
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
  status: "running" | "suspended" | "completed" | "failed" | "cancelled";
  result?: unknown;
};

export function publishWorkflow<I, O>(input: PublishedWorkflow<I, O>) {
  if (!input.name.trim()) throw new Error("publishWorkflow requires a non-empty MCP tool name");
  return input;
}
```

Export these values and types from `packages/mcp/src/index.ts`.

- [ ] **Step 4: Verify types and durable identity separation**

Run:

```bash
npm run build
node scripts/check-mcp-runtime-types.mjs
```

Expected: PASS; the public MCP name differs from but does not mutate the
Workflow ID.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/mcp/src scripts/check-mcp-runtime-types.mjs
git commit -m "feat(mcp): define published Workflow contract"
```

### Task 3: Add idempotent invocation storage outside Core

**Files:**
- Create: `packages/mcp/src/invocation-store.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `scripts/check-mcp-invocation-store.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing idempotency and restart checks**

The check must create a temporary directory with `mkdtemp`, claim the same key
twice concurrently, reopen the store, and confirm one durable record:

```js
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileMcpInvocationStore } from "../packages/mcp/dist/index.js";

const dir = await mkdtemp(join(tmpdir(), "uair-mcp-invocations-"));
const store = new JsonFileMcpInvocationStore(dir);
const input = {
  principalKey: "acme:E1001",
  toolName: "leave.request",
  idempotencyKey: "request-42"
};
const record = { ...input, executionId: "exp_leave_42", createdAt: 1 };

assert.equal(await store.find(input), null);
assert.deepEqual(await store.saveIfAbsent(record), record);
assert.deepEqual(await store.saveIfAbsent({ ...record, executionId: "exp_duplicate" }), record);
const reopened = new JsonFileMcpInvocationStore(dir);
assert.deepEqual(await reopened.find(input), record);
console.log("UAIR MCP invocation idempotency store: PASS");
```

- [ ] **Step 2: Run it and confirm the missing store**

Run `npm run build && node scripts/check-mcp-invocation-store.mjs`.

Expected: FAIL because `JsonFileMcpInvocationStore` is not exported.

- [ ] **Step 3: Implement the narrow store interface**

`packages/mcp/src/invocation-store.ts` must export:

```ts
export type McpInvocationIdentity = {
  principalKey: string;
  toolName: string;
  idempotencyKey: string;
};

export type McpInvocationRecord = McpInvocationIdentity & {
  executionId: string;
  createdAt: number;
};

export interface McpInvocationStore {
  find(identity: McpInvocationIdentity): Promise<McpInvocationRecord | null>;
  saveIfAbsent(record: McpInvocationRecord): Promise<McpInvocationRecord>;
}
```

Implement `InMemoryMcpInvocationStore` with a `Map` and
`JsonFileMcpInvocationStore` with one encoded JSON file per identity. Use
`open(path, "wx")` for first-writer-wins; on `EEXIST`, read and return the
winner. Encode the identity with a SHA-256 digest rather than putting tenant,
principal or tool names in a filename.

- [ ] **Step 4: Verify persistence and duplicate suppression**

Run:

```bash
npm run build
node scripts/check-mcp-invocation-store.mjs
```

Expected: `UAIR MCP invocation idempotency store: PASS`.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/mcp/src scripts/check-mcp-invocation-store.mjs
git commit -m "feat(mcp): persist invocation idempotency handles"
```

### Task 4: Build the transport-independent Runtime host

**Files:**
- Create: `packages/mcp/src/runtime-host.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `scripts/check-mcp-runtime-host.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing start/read/authorization tests**

Build two Workflows in `scripts/check-mcp-runtime-host.mjs`: one completes and
one suspends with an Interaction assigned to `manager-1`. Use `JsonFileStorage`
and `JsonFileMcpInvocationStore` under a temporary directory. Assert:

```js
const tools = await host.listTools(employee);
assert.deepEqual(tools.map(item => item.name), ["leave.request"]);

const first = await host.start({
  principal: employee,
  toolName: "leave.request",
  input: { days: 3 },
  idempotencyKey: "leave-1"
});
const retry = await host.start({
  principal: employee,
  toolName: "leave.request",
  input: { days: 3 },
  idempotencyKey: "leave-1"
});
assert.equal(retry.executionId, first.executionId);

await assert.rejects(
  host.read({ principal: stranger, executionId: first.executionId }),
  /MCP Runtime authorization denied/
);
await assert.rejects(
  host.resolve({ principal: employee, interactionId: "manager-approval", value: true }),
  /MCP Runtime authorization denied/
);
```

Also recreate the host with the same Invocation store and retry the start to
prove a lost response does not create a second Execution.

Use a deny-by-action authorizer to assert that unauthorized `discover`,
`start`, `read`, `resolve` and `cancel` each fail before touching Storage or the
underlying Workflow.

- [ ] **Step 2: Run the test to verify the host is missing**

Run `npm run build && node scripts/check-mcp-runtime-host.mjs`.

Expected: FAIL because `createMcpRuntimeHost` does not exist.

- [ ] **Step 3: Implement only five host operations**

Create `packages/mcp/src/runtime-host.ts` with:

```ts
export type McpRuntimeHost = {
  listTools(principal: McpRuntimePrincipal): Promise<McpPublishedTool[]>;
  start(input: StartMcpWorkflowInput): Promise<McpExecutionHandle>;
  read(input: ReadMcpExecutionInput): Promise<McpExecutionHandle>;
  resolve(input: ResolveMcpInteractionInput): Promise<McpExecutionHandle>;
  cancel(input: CancelMcpExecutionInput): Promise<McpExecutionHandle>;
};

export function createMcpRuntimeHost(options: {
  storage: Storage;
  workflows: PublishedWorkflow[];
  invocations: McpInvocationStore;
  authorize: McpRuntimeAuthorizer;
  interactions?: InteractionService;
}): McpRuntimeHost;
```

Implementation rules:

1. Build one `Map` keyed by published tool name and reject duplicates.
2. Call `authorize` immediately before each discovery/start/read/resolve/cancel.
3. For `start`, query the Invocation store first; if present, load and return
   the original Execution.
4. Otherwise call `run()` from `@uair/core` directly, persist the invocation
   record before returning, and project the resulting Execution. Do not add a
   dependency from `@uair/mcp` to `@uair/agent`.
5. `read` loads only the named Execution and never returns its History.
6. `resolve` delegates to `InteractionService.resolve()` using `principal.id`.
7. `cancel` supports a currently suspended Execution by cancelling its pending
   Suspension. For a running Execution, return an explicit
   `McpExecutionNotCancellableError`; do not invent a Core cancellation state.
8. The projection returns result only for completed Executions.

- [ ] **Step 4: Verify authorization, idempotency and manager isolation**

Run:

```bash
npm run build
node scripts/check-mcp-runtime-host.mjs
npm run check:suspension-race
npm run check:security-hardening
```

Expected: all checks pass.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/mcp/src scripts/check-mcp-runtime-host.mjs
git commit -m "feat(mcp): project Workflows through an authorized runtime host"
```

### Task 5: Expose the Runtime host through the official MCP server SDK

**Files:**
- Modify: `packages/mcp/package.json`
- Modify: `package-lock.json`
- Create: `packages/mcp/src/server.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `scripts/check-mcp-server.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the official server dependency**

Run:

```bash
npm install --workspace @uair/mcp @modelcontextprotocol/server@2.0.0
```

Expected: `packages/mcp/package.json` contains an exact compatible server SDK
dependency and npm reports zero vulnerabilities.

- [ ] **Step 2: Write a failing real-protocol check**

Use the SDK `InMemoryTransport` to connect an actual MCP Client to an actual
server built by `createMcpRuntimeServer`. Assert `tools/list` exposes only the
published Workflow plus three fallback tools, and `tools/call` returns
structured content with `kind: "uair.execution"`.

The client-side call must attach:

```js
_meta: {
  "io.uair/idempotency-key": "leave-100",
  "io.uair/test-principal": "employee-1"
}
```

The test `resolvePrincipal` reads only the test-principal metadata. Production
hosts must obtain the Principal from their authenticated request context.

- [ ] **Step 3: Run the protocol check and observe the missing server**

Run `npm run build && node scripts/check-mcp-server.mjs`.

Expected: FAIL because `createMcpRuntimeServer` is not exported.

- [ ] **Step 4: Register Workflows and fallback tools**

Create `packages/mcp/src/server.ts` with this public factory:

```ts
import { McpServer } from "@modelcontextprotocol/server";

export function createMcpRuntimeServer(options: {
  name: string;
  version: string;
  host: McpRuntimeHost;
  resolvePrincipal(context: unknown): Promise<McpRuntimePrincipal> | McpRuntimePrincipal;
}) {
  const server = new McpServer({ name: options.name, version: options.version });
  // Register authorized published Workflows and the three fallback tools.
  return server;
}
```

Registration rules:

- `tools/list` visibility comes from `host.listTools(principal)`; do not leak
  unauthorized tool names through a global static registry.
- A published Workflow tool passes its JSON Schema through the SDK's Standard
  Schema adapter and calls `host.start`.
- Require the namespaced idempotency key for long-running Workflow start.
- `uair.execution.get` accepts `{ executionId }`.
- `uair.execution.cancel` accepts `{ executionId }`.
- `uair.interaction.resolve` accepts `{ interactionId, value }`.
- Successful calls return both text content and identical structured content.
- Known authorization/input/not-found failures return `isError: true` without
  stack traces or raw History.

Use the SDK's documented low-level `server.setRequestHandler("tools/list", …)`
API for principal-aware discovery and `server.setRequestHandler("tools/call", …)`
for dispatch. Use `fromJsonSchema()` to adapt the already-declared JSON Schema.
Keep both low-level handlers inside this file; do not weaken discovery
authorization to fit the high-level static registry convenience API.

- [ ] **Step 5: Verify the real MCP exchange**

Run:

```bash
npm run build
node scripts/check-mcp-server.mjs
npm run check:mcp-client
npm run check:adapter-api
```

Expected: real initialization, `tools/list` and `tools/call` pass without
public API regressions.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/mcp scripts/check-mcp-server.mjs
git commit -m "feat(mcp): expose authorized UAIR Workflows as MCP tools"
```

### Task 6: Merge multiple MCP sources without tool collisions

**Files:**
- Create: `packages/mcp/src/multi-source.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `scripts/check-mcp-multi-source.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing collision test**

Create two fake adapters, both exposing `calendar.create`. Assert the merged
catalog contains two stable IDs and dispatches to the correct server:

```js
const merged = await createMcpCapabilitySet({ personal, company });
assert.deepEqual(
  merged.list().map(item => item.id).sort(),
  ["company:calendar.create", "personal:calendar.create"]
);
await merged.get("personal:calendar.create").invoke({ title: "Local" });
await merged.get("company:calendar.create").invoke({ title: "Work" });
assert.deepEqual(calls, ["personal", "company"]);
```

- [ ] **Step 2: Run it and confirm the helper is missing**

Run `npm run build && node scripts/check-mcp-multi-source.mjs`.

Expected: FAIL because `createMcpCapabilitySet` does not exist.

- [ ] **Step 3: Implement qualification in the MCP package**

Add a dependency on `@uair/capability` and implement:

```ts
export async function createMcpCapabilitySet(
  sources: Record<string, McpServerAdapter>
): Promise<CapabilitySet>;
```

For every discovered tool, create a Capability with:

```ts
{
  id: `${sourceName}:${tool.name}`,
  kind: "tool",
  description: tool.description,
  inputSchema: tool.inputSchema,
  metadata: { source: sourceName, remoteToolName: tool.name },
  invoke: sources[sourceName].tool(tool.name)
}
```

Validate source names against `^[A-Za-z0-9._-]+$` and reject duplicates before
building the set.

- [ ] **Step 4: Verify collision-free dispatch**

Run:

```bash
npm run build
node scripts/check-mcp-multi-source.mjs
npm run check:agent-validation
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/mcp scripts/check-mcp-multi-source.mjs
git commit -m "feat(mcp): qualify tools from multiple runtime sources"
```

### Task 7: Add real stdio and Streamable HTTP reference hosts

**Files:**
- Create: `examples/multi-runtime-mcp/package.json`
- Create: `examples/multi-runtime-mcp/tsconfig.json`
- Create: `examples/multi-runtime-mcp/src/workflows.ts`
- Create: `examples/multi-runtime-mcp/src/local-server.ts`
- Create: `examples/multi-runtime-mcp/src/company-server.ts`
- Create: `examples/multi-runtime-mcp/src/agent-client.ts`
- Create: `examples/multi-runtime-mcp/README.md`
- Create: `scripts/check-multi-runtime-mcp.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing cross-process harness**

The harness must:

1. Create one temporary directory for local SQLite and one for company data.
2. Spawn `local-server.js` over stdio.
3. Spawn `company-server.js` on an ephemeral localhost port.
4. Run `agent-client.js` with both connection profiles.
5. Assert the JSON output contains one local reminder handle and one company
   leave handle with different Execution IDs and source names.
6. Disconnect the company MCP client and verify the company Execution remains
   present and non-cancelled in the company host.
7. Stop the company process and invoke another local reminder successfully.
8. Restart the Agent client and read the previously stored company handle.
9. Verify the personal data directory contains no company Execution or History.

Use `spawn` argument arrays, bounded readiness messages and a 20-second overall
timeout. Do not use shell interpolation for child commands.

- [ ] **Step 2: Run the harness and confirm the example is absent**

Run `node scripts/check-multi-runtime-mcp.mjs`.

Expected: FAIL because the compiled example entrypoints do not exist.

- [ ] **Step 3: Implement two small Workflows**

In `workflows.ts`, define:

```ts
export const createReminder = workflow("personal.reminder.create", async input => ({
  reminderId: `reminder:${input.at}`,
  at: input.at,
  message: input.message
}));

export const requestLeave = workflow("hr.leave.request", async input => ({
  requestId: `leave:${input.employeeId}:${input.date}`,
  status: "submitted"
}));
```

Use Components only for the simulated external notification/audit boundaries;
keep pure formatting as ordinary TypeScript.

- [ ] **Step 4: Implement the local stdio host**

Use `JsonFileStorage`, `JsonFileMcpInvocationStore`,
`createMcpRuntimeHost`, `createMcpRuntimeServer` and the SDK
`StdioServerTransport`. Publish only `reminder.create`. Resolve the local
Principal from the current process configuration and allow only that principal.

- [ ] **Step 5: Implement the company HTTP host**

Use a separate Storage directory and publish only `leave.request`. The HTTP
entrypoint must:

- bind to `127.0.0.1` for the reference test;
- validate Origin according to the SDK transport defaults;
- resolve a test Principal from a signed test bearer token supplied by the
  harness;
- reject a missing/invalid token before MCP dispatch;
- authorize `employee-1` for start/read of only their company Execution;
- never pass the bearer token into Workflow input, History or Component calls.

The signed test token is test infrastructure, not a UAIR OAuth implementation.
Document that production uses MCP OAuth/OIDC middleware before
`resolvePrincipal`.

- [ ] **Step 6: Implement the one-Agent client**

Connect to local stdio with the existing explicit process allowlist and to the
company server with Streamable HTTP. Use `createMcpCapabilitySet` and invoke:

```text
personal:reminder.create
company:leave.request
```

Persist only `{ source, executionId, workflowId, status }` in the Agent state
file. Do not persist remote input, result details or History.

- [ ] **Step 7: Run the full reference scenario**

Run:

```bash
npm run build
node scripts/check-multi-runtime-mcp.mjs
```

Expected: the harness prints
`UAIR MCP multi-runtime cross-process verification: PASS`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json examples/multi-runtime-mcp scripts/check-multi-runtime-mcp.mjs
git commit -m "feat: demonstrate one Agent across local and company runtimes"
```

### Task 8: Add optional MCP Tasks projection without breaking fallback clients

**Files:**
- Create: `packages/mcp/src/tasks.ts`
- Modify: `packages/mcp/src/server.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `scripts/check-mcp-tasks.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write capability-negotiation tests first**

Test two clients against the same server:

```text
Tasks-capable client
→ receives an MCP Task backed by a UAIR Execution
→ tasks/get reports working/input_required/completed

fallback client
→ receives structured uair.execution content
→ uses uair.execution.get
```

Also assert the Task cannot be read or cancelled under a different Principal
and that no Task is returned before its Execution is loadable from Storage.

- [ ] **Step 2: Run it and confirm fallback-only behavior**

Run `npm run build && node scripts/check-mcp-tasks.mjs`.

Expected: fallback assertions pass and Tasks assertions fail because the server
does not advertise the extension.

- [ ] **Step 3: Implement a lossy Task projection**

Create `packages/mcp/src/tasks.ts` with pure mappings:

```ts
export function executionTaskStatus(status: Execution["status"]) {
  switch (status) {
    case "running": return "working" as const;
    case "suspended": return "input_required" as const;
    case "completed": return "completed" as const;
    case "failed": return "failed" as const;
    case "cancelled": return "cancelled" as const;
  }
}
```

Use the official Tasks extension only after both client and server negotiate
it. Bind Task access to the same Principal key used by the Invocation store.
Do not expose complete History in Task status or result.

If the installed SDK exposes the 2025 experimental Tasks capability rather
than the current extension, do not silently implement the legacy form. Pin the
supported negotiated revision in `@uair/mcp` documentation and keep fallback
behavior for incompatible clients.

- [ ] **Step 4: Verify both negotiated and fallback paths**

Run:

```bash
npm run build
node scripts/check-mcp-tasks.mjs
node scripts/check-mcp-server.mjs
node scripts/check-multi-runtime-mcp.mjs
```

Expected: both clients pass against one server.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/mcp/src scripts/check-mcp-tasks.mjs
git commit -m "feat(mcp): map durable Executions to negotiated MCP Tasks"
```

### Task 9: Document security, compatibility and developer usage

**Files:**
- Modify: `packages/mcp/README.md`
- Modify: `docs/reference/adapter-compatibility.md`
- Modify: `docs/security/hardening.md`
- Create: `docs/guides/multi-runtime-agent.md`
- Modify: `docs/operations/test-matrix.md`
- Modify: `scripts/check-docs-acceptance.mjs`

- [ ] **Step 1: Add failing documentation assertions**

Extend `scripts/check-docs-acceptance.mjs` to require these exact concepts:

```text
MCP-first Multi-Runtime
stdio local Runtime
Streamable HTTP remote Runtime
OAuth protected resource
explicit Workflow publication
MCP Tasks fallback
remote History remains remote
A2A is optional and outside Core
```

- [ ] **Step 2: Run and observe missing documentation**

Run `npm run check:docs-acceptance`.

Expected: FAIL on the new guide requirements.

- [ ] **Step 3: Write one runnable guide**

Document installation, the two connection profiles, explicit publication,
one-Agent tool qualification, the OAuth host boundary, fallback behavior and
the exact example command:

```bash
npm run build
node scripts/check-multi-runtime-mcp.mjs
```

State explicitly that `WorkerDirectory` is intra-Runtime deployment routing,
not cross-Runtime discovery.

- [ ] **Step 4: Update adapter and security contracts**

Record the server-side public exports, supported MCP protocol/Tasks revision,
token non-passthrough rule, authorization actions, Task binding and History
boundary. Add the new checks to the test matrix without claiming production
OAuth interoperability was tested.

- [ ] **Step 5: Verify documentation gates**

Run:

```bash
npm run check:docs-acceptance
npm run check:adapter-api
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/README.md docs scripts/check-docs-acceptance.mjs
git commit -m "docs: explain MCP-first multi-runtime agents"
```

### Task 10: Run architecture and release gates

**Files:**
- Modify only if a gate finds a defect in files already listed above.

- [ ] **Step 1: Run focused MCP checks**

```bash
npm run build
npm run check:mcp-client
node scripts/check-mcp-runtime-types.mjs
node scripts/check-mcp-invocation-store.mjs
node scripts/check-mcp-runtime-host.mjs
node scripts/check-mcp-server.mjs
node scripts/check-mcp-multi-source.mjs
node scripts/check-mcp-tasks.mjs
node scripts/check-multi-runtime-mcp.mjs
```

Expected: every check prints PASS.

- [ ] **Step 2: Run UAIR governance**

```bash
node /Users/yohoyes/Documents/uair-builder/packages/cli/dist/cli.js lint
node /Users/yohoyes/Documents/uair-builder/packages/cli/dist/cli.js impact @uair/mcp
```

Expected: zero hard governance errors. Review and explain warnings rather than
refactoring automatically.

- [ ] **Step 3: Run broader compatibility and security gates**

```bash
npm run check:package-boundaries
npm run check:durable-semantics
npm run check:security-hardening
npm run check:suspension-race
npm run check:agent-validation
npm run check:adapter-api
npm run check:docs-acceptance
npm run verify
```

Expected: all pass. Do not claim PostgreSQL/OAuth environment-dependent tests
unless they are separately executed with their required services.

- [ ] **Step 4: Inspect repository scope**

```bash
git status --short
git diff --check
git diff --stat origin/codex/package-boundaries...HEAD
```

Expected: only planned MCP, example, script, package-lock and documentation
changes; Graphify artifacts remain untracked and uncommitted.

- [ ] **Step 5: Commit any gate-driven correction**

If verification required a correction, commit only the files involved:

```bash
git add package.json package-lock.json packages/mcp examples/multi-runtime-mcp scripts docs
git commit -m "fix(mcp): satisfy multi-runtime release gates"
```

If no correction was required, do not create an empty commit.

## Implementation boundary after this plan

Completion of this plan proves one Agent can use two autonomous Runtime hosts
through existing MCP protocols. It does not prove interoperability with every
enterprise OAuth provider, NAT traversal, mobile background execution, public
Internet deployment, A2A delegation or multi-region disaster recovery. Those
require separate evidence and separate approved specifications.
