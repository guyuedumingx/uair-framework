# UAIR Agent Boundary — v0.52

UAIR must add durable execution semantics to existing Agent frameworks without
becoming their memory, context, checkpoint, skill, or reasoning runtime.

The default rule is:

```text
Agent internals are opaque.
UAIR owns only explicit durable system boundaries.
```

## State ownership

Four state spaces must remain distinct:

```text
1. UAIR Execution State
   Execution / History / Effect / Suspension

2. Agent Runtime State
   thread / checkpoint / graph state / planner state

3. Agent Memory
   conversation / semantic / episodic / user memory

4. Agent Skills
   instructions / tools / resources / domain procedures
```

UAIR owns (1).

For (2), UAIR may persist an opaque `sessionRef` supplied by an adapter.

UAIR does not own (3) or (4).

## Mode A — UAIR hosts an existing Agent

`@uair/agent` now provides:

```ts
const step =
  externalAgent(
    "research",
    existingAgentRuntime
  );
```

The adapter executes one external Agent turn as a normal UAIR Component.

It does not inspect or translate:

```text
messages
system/developer prompt
vector memory
checkpoint contents
graph state
skill instructions
skill registry
reasoning state
```

If the Agent needs external input, it returns:

```ts
{
  type: "suspended",
  sessionRef: opaqueRef,
  request: ...
}
```

The containing UAIR Workflow suspends in a separate Interaction/Suspension:

```text
external Agent step
→ returns sessionRef + request
→ UAIR Interaction suspends
→ external input arrives
→ UAIR resumes
→ external Agent step(sessionRef, answer)
```

This separation is required by Core replay semantics. A Component that calls
`ctx.suspend()` directly resolves to the suspension value on replay; it is not
a generic continuation mechanism for an arbitrary external Agent loop.

## Why sessionRef is enough

The external framework remains responsible for its own durable checkpoint.

Examples:

```text
LangGraph thread/checkpoint ID
OpenAI/other Agent session ID
custom agent conversation ID
remote actor/session handle
```

UAIR persists only the reference as ordinary Component output.

The reference is opaque. UAIR does not parse it.

## Restart verification

v0.52 explicitly tests:

```text
external Agent instance A
→ creates private memory/checkpoint
→ returns opaque sessionRef
→ UAIR suspends

Agent process is replaced

external Agent instance B
→ receives the same sessionRef
→ loads memory from Agent-owned checkpoint store
→ reloads its own Skill registry
→ continues successfully
```

The final result is identical to direct execution of the same Agent without
UAIR.

## No Memory regression

The test Agent owns private state containing markers such as:

```text
PRIVATE_MEMORY::user-prefers-espresso
existing-agent-system-context
```

UAIR History is asserted not to contain those values.

Only the explicit Agent Component boundary is durable:

```text
input
turn result
opaque sessionRef
explicit external request
```

This prevents Execution History from becoming an accidental LLM context store.

## No Skill regression

The external Agent owns a private Skill registry and Skill instructions.

The v0.52 baseline compares:

```text
Agent run directly
vs
Agent run through UAIR + suspend/resume + runtime restart
```

The following must remain equal:

```text
final semantic output
Skill invocation count
Memory-derived behavior
Skill availability
```

UAIR History is also asserted not to contain private Skill instructions.

Therefore UAIR does not need a Core `Skill` primitive.

## Mode B — existing Agent calls UAIR

Sometimes the Agent should remain the outer orchestrator.

`durableWorkflowTool()` exposes a UAIR Workflow as a durable capability:

```ts
const checkout =
  durableWorkflowTool(
    checkoutWorkflow,
    storage
  );

const result =
  await checkout.start({
    sku: "tea"
  });
```

The Agent keeps its own:

```text
messages
memory
skills
planning loop
```

UAIR owns only the invoked business Workflow execution.

The verification checks that Agent memory and Skill registry are unchanged and
are not copied into the UAIR Workflow History.

## Authoritative orchestrator rule

Do not make two systems authoritative for the same long-running control flow.

### Fixed enterprise business flow

Recommended:

```text
UAIR Workflow = outer orchestrator
Existing Agent = intelligent Component/step
```

### Open-ended autonomous Agent

Often better:

```text
Existing Agent = outer orchestrator
UAIR Workflow = durable tool/capability
```

### Existing Agent already owns durable interrupts/checkpoints

Either:

```text
keep the entire Agent opaque as one UAIR boundary
```

or write an explicit adapter that maps selected interrupt boundaries.

Do not independently replay both orchestration graphs.

## What not to do

Do not:

```text
messages = execution.history
```

Do not introduce:

```text
UAIRMemory
UAIRConversationMemory
UAIRSkillState
UAIRScratchpad
```

Do not wrap every internal Agent tool call as a UAIR Component merely for
observability.

Only promote operations that need system-level guarantees, for example:

```text
irreversible payment
email/send side effect
database mutation
deployment
human interaction
long external wait
business Workflow boundary
```

## Native UAIR Agent vs external Agent adapter

`agent()` in `@uair/agent` remains useful for Agents intentionally built on UAIR
Components. Its tools may participate in UAIR durability.

`externalAgent()` is for an existing Agent framework whose internal loop,
memory and Skills should stay native.

## Codex App Server

`@uair/agent` also provides `CodexAppServerRuntime` for embedding the OpenAI
Codex harness through its documented bidirectional app-server protocol:

```ts
const codex =
  externalAgent(
    "codex",
    new CodexAppServerRuntime({
      onServerRequest: request => approvalUi.resolve(request)
    })
  );
```

The adapter drives `initialize`, `thread/start` or `thread/resume`, and
`turn/start`, then consumes streamed notifications until `turn/completed`.
Codex conversation history, skills, sandbox state, and checkpoints remain
owned by Codex. UAIR persists only the explicit Component boundary and the
opaque Codex thread reference. Approval and tool-input requests are surfaced
to the host through `onServerRequest`; the host must map them to its own
approval/interaction policy. The default transport is local `codex app-server`
over JSONL stdio. Remote hosts should supply an authenticated custom transport
or use SSH/port forwarding; the adapter does not expose an unauthenticated
public WebSocket.

These are two valid integration modes; neither should replace the other.

## Skills

v0.52 intentionally does not add a UAIR Skill abstraction.

A Skill may be:

```text
instructions
prompt bundle
resources
scripts
tool collection
framework-native procedure
```

That is too framework-specific to normalize safely.

UAIR may later discover *capabilities* exposed by Skills, but Skill ownership
stays with the Agent framework.

A future resolver may map:

```text
Capability
├─ npm package
├─ MCP server
├─ existing API
├─ Agent Skill
└─ generated implementation
```

without requiring those sources to share one internal representation.

## v0.52 verified matrix

```text
UAIR → existing Agent                        PASS
Direct Agent vs hosted semantic result       IDENTICAL
Agent private Memory preserved               PASS
Agent private context not copied to History  PASS
Agent Skill registry preserved               PASS
Agent Skill instructions not copied          PASS
Agent runtime restart during suspension      PASS
Opaque sessionRef continuation               PASS
Existing Agent → UAIR Workflow               PASS
Outer Agent Memory preserved                 PASS
Outer Agent Skills preserved                 PASS
```

The design result is deliberately small: two adapter utilities in
`@uair/agent`, zero Agent/Memory/Skill primitives added to Runtime Core.
