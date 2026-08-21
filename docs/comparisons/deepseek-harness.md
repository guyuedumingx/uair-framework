# UAIR vs DeepSeek Harness — 2026-08-20

This comparison is about architectural positioning, not a benchmark claim. The two systems overlap, but they optimize for different primary jobs.

## Current DeepSeek Harness position

DeepSeek Harness (`dsh`) is an open-source agent harness in developer preview. Its architecture is built on Cordis and explicitly follows "everything is a plugin": model adapters, tool registry, session log, agent loop, sandbox, storage, scheduler, and UI are composed through plugins/services/events.

A runnable setup is assembled through profiles, bundles, package manifests, patch layers, and Cordis plugin rows. Its session event log is the source for model-visible context, replay, transcripts, telemetry, and persistence.

Its tool system is relatively mature: typed parameter schemas, runtime argument validation, canonical return values, model-facing rendering, UI presentation projections, policy interception, Code Mode, background jobs, and scoped tool registration.

Sources reviewed:

```text
https://github.com/deepseek-ai/deepseek-harness
https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md
https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md
```

## Different center of gravity

```text
DeepSeek Harness
  Agent product/runtime composition first

UAIR
  Durable application execution first
```

DeepSeek Harness asks:

```text
How can every part of an Agent be replaceable and composable?
```

UAIR asks:

```text
How can ordinary TypeScript + AI + human UI run as a durable,
governed application that survives crashes and deployments?
```

Neither goal subsumes the other.

## Where DeepSeek Harness is currently stronger

### 1. Agent-native product completeness

DSH already has a coherent coding-agent product surface:

```text
model adapters
tools
skills
sessions
subagents
LSP
sandbox
web UI
Code Mode
profiles/presets
```

UAIR has Agent primitives and adapters, but not an equally complete general-purpose coding-agent product.

### 2. Plugin lifecycle and runtime composability

Cordis registrations are reversible effects. Plugins can contribute and remove services/events in a shared runtime composition.

UAIR deliberately avoids making every capability a plugin. npm packages and adapters are simpler, but UAIR currently has less sophisticated hot composition/unload behavior.

### 3. Model-visible session semantics

DSH has a strong invariant:

```text
model-visible means logged
```

Its session log is a dedicated durable model-context source.

UAIR durable History is strong for execution semantics, but a rich multi-turn conversational/session model should remain a separate package and is not yet equally mature.

### 4. Tool contract maturity

DSH's first-party tool authoring has:

```text
typed schema inference
runtime argument validation
canonical JSON outputs
model rendering
UI card projection
policy hooks
background jobs
Code Mode integration
```

UAIR's tool layer is intentionally thinner. v0.36 adds a dependency-free `parseArgs` hook, but UAIR does not yet own an equivalent full tool-schema/presentation ecosystem.

### 5. Ecosystem and adoption

DeepSeek Harness already has an active public repository, a rapidly evolving plugin ecosystem, official product exposure, and significant community attention.

UAIR is still an alpha candidate and has not earned that ecosystem evidence.

## Where UAIR is currently stronger

### 1. Deterministic business Workflow boundary

UAIR keeps mandatory business governance in ordinary code:

```ts
await permission();
const result = await agent();
const decision = await approval();
await audit();
```

The Agent may choose dynamic tools inside its boundary, but it cannot prompt its way around approval/audit/persistence outside that boundary.

This is particularly valuable for:

```text
OA
financial operations
approval systems
enterprise automation
long-running human-in-the-loop applications
```

### 2. Suspension is a durable control-flow primitive

Blocking UI is not just a chat card or event listener:

```text
UI
→ Suspension
→ persist
→ process may die
→ user answers later
→ resume/replay
```

This lets human interaction participate directly in application execution semantics.

### 3. Crash/replay semantics around side effects

UAIR's Component/History model has been attacked with:

```text
retry
worker crash
ACK-before/after windows
visibility timeout
redelivery
multi-process claim races
SIGKILL
```

The tested design is:

```text
queue delivery = at-least-once
effect execution = durable replay-aware
```

This is a different concern from an Agent session log.

### 4. Long-lived deployment identity

UAIR explicitly pins:

```text
workflow id
workflow version
workflow fingerprint
deployment id
history schema version
```

and routes old executions to compatible worker deployments.

This is central for workflows that may suspend for days/months while code continues to deploy.

### 5. Cluster execution semantics

UAIR has explicit reference designs for:

```text
reliable job leases
ACK/NACK
visibility timeout
DLQ
worker heartbeat
draining
capacity reservation
leaderless schedulers
shared worker registry
version-aware routing
```

These are first-class consequences of its durable-application focus.

### 6. Simpler application mental model

UAIR application authors can stay mostly inside:

```text
Workflow
Component
```

They do not need to understand profiles, bundles, patch rows, service injection, event waterfall ordering, or plugin lifecycle to write a normal application.

## Magic strings / identities

DeepSeek Harness does not eliminate stable names either. Examples include:

```text
plugin name
inject service keys
tool name
profile name
bundle name
patch row id
ctx service key
event names
```

That is normal: distributed/plugin systems need protocol identities.

UAIR's v1 rule is:

```text
explicit once
referenced by object thereafter
```

Preferred:

```ts
export const approval =
  workflow({
    id: "order.approval",

    async run(input) {
      ...
    }
  });

new RuntimeEngine(
  storage,
  [
    approval
  ]
);
```

Not:

```ts
const approval =
  workflow(
    "order.approval",
    ...
  );

new RuntimeEngine(
  storage,
  {
    "order.approval":
      approval
  }
);
```

Similarly:

```ts
const search =
  component({
    id: "search",
    async run(args) {
      ...
    }
  });

const tool =
  asAgentTool(search);

return {
  type: "tool",
  tool: search.id,
  args: ...
};
```

The ID cannot safely be inferred from a JS variable/function/file name because durable executions must survive refactors, minification, bundling, and deployment.

## What UAIR should selectively learn from DSH

### Adopt: runtime validation seam for tools

Do not invent a UAIR schema DSL yet.

Support:

```ts
asAgentTool(
  search,
  {
    inputSchema:
      jsonSchemaForModel,

    parseArgs(value) {
      return zodSchema.parse(
        value
      );
    }
  }
);
```

This lets Zod/Valibot/ArkType/etc own validation while UAIR guarantees validation occurs before tool execution.

### Adopt later: canonical tool output / presentation separation

A future ecosystem package can distinguish:

```text
canonical programmatic value
model-facing rendering
UI presentation metadata
```

This is useful, but does not belong in Runtime Core.

### Adopt later: durable Agent session package

Create an optional:

```text
@uair/session
```

whose invariant can be analogous to:

```text
model-visible context must be reconstructable
```

Do not overload Execution History with conversational/session semantics.

### Do not copy: "everything is a plugin"

UAIR should not convert:

```text
Workflow
Component
Suspension
History
```

into plugins.

The kernel's value comes from having a small amount of privileged durable semantics.

### Do not copy by default: profile/bundle/patch composition

npm package composition + normal TypeScript should remain the default.

A declarative deployment composition layer may be useful later, but it should be optional and generated from ordinary package contracts rather than required for basic application development.

## Strategic positioning

A useful one-line distinction:

```text
DeepSeek Harness:
build and compose highly extensible Agents.

UAIR:
build durable software where Agents are one controlled execution primitive.
```

That positioning is stronger than trying to beat DSH at being another general-purpose coding-agent harness.

## Remaining UAIR gaps before production claims

```text
real PostgreSQL integration gate must be observed green
10k+ execution soak
real sandbox backend security review
mature model/session package
tool validation/presentation ecosystem
documentation/examples/community
package namespace and license decision
```

## Recommendation

Do not expand the UAIR kernel.

For v1-alpha, focus on:

```text
DX and identity cleanup
runtime validation hooks
real database/process fault evidence
documentation
package publishing
one excellent enterprise demo
one excellent agentic demo
```

The biggest competitive advantage is not "more plugins".

It is:

> ordinary code with durable execution semantics, bounded AI autonomy, and fixed governance.
