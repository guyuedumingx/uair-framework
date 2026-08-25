# UAIR Agent

## Native Agent action contract

`agent()` treats every `AgentModel` result as untrusted runtime data and
validates it before tool selection or execution. Use `parseAgentAction()` for a
provider-neutral parser, or supply a schema adapter through
`jsonAgentModel(..., { parseAction })` / `AgentOptions.parseAction`.

Provider-native structured output is preferred where available. UAIR does not
own a schema DSL; adapters may use Zod, Valibot, ArkType, Standard Schema or an
equivalent library.

Custom action parsers are deterministic, side-effect-free TypeScript. External
lookups or other nondeterministic work still belong in Components.

Nondeterministic model/provider I/O belongs in a Component. A custom
`AgentModel.decide()` may perform deterministic TypeScript work directly, but
must delegate external model calls to a Component so replay uses recorded
History rather than repeating an untracked request.

## v0.52 — Existing Agent compatibility boundary

Use `externalAgent()` when an existing Agent framework should keep ownership of
its memory, prompt/context, checkpoint and Skills.

```ts
const step = externalAgent(
  "research",
  existingRuntime
);
```

If the external Agent needs input, return a `suspended` turn with an opaque
`sessionRef`; let the containing UAIR Workflow perform the actual
Interaction/Suspension, then invoke the Agent step again with the same
`sessionRef` and resume value.

Use `durableWorkflowTool()` for the inverse topology, where the existing Agent
remains the outer orchestrator and invokes a UAIR Workflow as one durable tool.

No Agent/Memory/Skill primitive was added to Runtime Core.

See `boundaries.md`.
