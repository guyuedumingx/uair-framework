
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
