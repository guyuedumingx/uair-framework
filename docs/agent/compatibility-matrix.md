# UAIR Agent Compatibility Matrix — v0.53

The compatibility rule is intentionally narrow:

```text
UAIR owns durable system execution.
The Agent framework keeps ownership of its own memory, session/checkpoint,
internal orchestration, skills, prompts, and tool loop.
```

This matrix is based on current public framework semantics and executable UAIR
boundary simulations. It does **not** claim live vendor API calls in the build
environment.

## Matrix

| Framework model | Native durable pointer | Native memory/state owner | Native interrupt/resume | Skill/tool owner | Default UAIR mode | Deep bridge by default? |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI Agents SDK | Session / resumable run state | Agents SDK Session / provider state | SDK HITL / resumable state | Agents SDK | opaque `sessionRef` | No |
| LangGraph | `thread_id` + checkpointer | LangGraph checkpoint/thread | `interrupt()` + `Command({resume})` | LangGraph / Agent layer | opaque `threadRef` | No |
| Claude managed/session model | session ID + pinned agent version | Claude session/event history | event-driven session continuation/tool confirmation | Claude agent configuration / skills | opaque `sessionRef` | No |
| Codex App Server | Codex thread/session ID | Codex app-server thread/rollout state | app-server server requests and turn continuation | Codex config/MCP/skills | opaque `sessionRef` | No |
| Custom Agent runtime | adapter-defined opaque ref | custom runtime | adapter-defined | custom runtime | opaque ref | No |

## OpenAI Agents SDK

Current Agents SDK exposes Sessions as persistent working context. The SDK
loads previous conversation items into a run and writes new items back. Tools,
MCP, handoffs, guardrails and agent-loop behavior remain SDK concepts.

UAIR therefore must **not** convert Session items into `Execution.history`.

Recommended topology for fixed business software:

```text
UAIR Workflow
↓
externalAgent(openaiAgent)
↓
OpenAI Agent + Session
```

If the agent needs external/human input:

```text
Agent turn returns opaque sessionRef + request
↓
UAIR Interaction suspends
↓
answer arrives
↓
Agent SDK is invoked again with its own session/ref
```

For an open-ended agent, invert the relationship:

```text
OpenAI Agent
↓ tool
UAIR durable Workflow
```

## Codex App Server

Codex App Server is a bidirectional JSON-RPC interface for embedding the Codex
harness in an application. `CodexAppServerRuntime` in `@uair/agent` owns only
the protocol client boundary:

```text
UAIR Workflow
↓
externalAgent("codex", CodexAppServerRuntime)
↓
Codex app-server thread/session
```

The adapter drives initialization, thread start/resume, turn start, streamed
notifications, and server-initiated approval/tool-input requests. Codex keeps
conversation history, skills, sandbox configuration, and checkpoints. The host
must provide `onServerRequest` for explicit approval handling. The default
transport is local JSONL stdio; remote hosts should provide an authenticated
custom transport or use SSH/port forwarding.

## LangGraph

LangGraph persistence is owned by its checkpointer and `thread_id`. Interrupts
save graph state and resume with the same thread ID plus a `Command` resume
value.

Important semantic mismatch:

```text
UAIR:
Execution is explicitly pinned to durable Workflow version semantics.

LangGraph:
existing checkpoints generally resume against the currently deployed graph,
so checkpoint compatibility is a graph-release responsibility.
```

Therefore the safe default is **opaque graph ownership**:

```text
UAIR stores only:
{ provider: "langgraph", threadId: "..." }

LangGraph stores:
checkpoint state
messages
node cursor
interrupt bookkeeping
memory
```

A deep node-by-node bridge is opt-in only and would need a dedicated semantic
compatibility proof. It must never be assumed merely because both runtimes can
suspend/resume.

## Claude managed/session model

Claude managed agents expose versioned agent definitions and sessions that
retain conversation/event history. Agent definitions can carry tools, MCP
servers and skills; sessions may pin an agent version.

UAIR therefore stores only the explicit external session reference needed to
continue the session. It does not clone:

```text
system prompt
skills
MCP configuration
tool configuration
session event history
sandbox state
```

The external platform's own session lifetime must be treated as a capability
contract. If a provider can expire unrecoverable state, the adapter must expose
that fact and the business Workflow must choose a recovery policy instead of
pretending the session is permanently durable.

## What v0.53 executes

`check:agent-compatibility` attacks four cases:

```text
UAIR → OpenAI-Session-shaped Agent
UAIR → LangGraph-thread-shaped Agent
UAIR → Claude-session-shaped Agent
External Agent → UAIR durable Workflow
```

For every hosted-Agent case it verifies:

```text
external process/runtime restart
opaque session/thread reference survives
framework-owned memory/checkpoint survives
framework-owned skills survive
private prompt/skill/checkpoint state is absent from UAIR History
UAIR Interaction resumes the outer business Workflow correctly
```

It also verifies the inverse topology does not copy an outer Agent's memory or
skill registry into the invoked UAIR Workflow.

## Adapter acceptance criteria

A real framework adapter is not production-compatible until all are true:

1. **State ownership:** no duplicate durable truth for memory/checkpoint.
2. **Restart:** agent process can disappear and recover from its native store.
3. **Interrupt:** native interruption semantics are preserved or deliberately
   kept opaque.
4. **Tools/skills:** native tools, MCP and skill registry remain available.
5. **No context leak:** prompts/memory/checkpoints do not enter UAIR History by
   default.
6. **Cancellation:** UAIR cancellation propagates where the provider supports
   cancellation, without corrupting native session state.
7. **Timeout/expiry:** provider session expiry is surfaced explicitly.
8. **Versioning:** framework-native version/checkpoint compatibility is not
   falsely replaced by UAIR Workflow versioning.
9. **Observability:** traces may correlate by IDs, but neither runtime becomes
   the other's trace store.
10. **Security:** credentials and provider auth remain adapter/host concerns.

## Result

The generic UAIR boundary is sufficient for the tested runtime models without
adding Memory, Skill, Thread, Checkpoint or Agent primitives to Core.
