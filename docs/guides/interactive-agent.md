# Build an Interactive Agent

UAIR should not own an Agent framework's memory, skills or checkpoints.

Two valid topologies:

```text
UAIR Workflow
→ Agent adapter/component
→ Agent-owned memory/session/skills
```

or:

```text
Agent
→ UAIR Workflow as durable tool
```

For long waits, keep Agent session state external and persist only an opaque
session/thread reference in UAIR.

Do not copy:

```text
conversation memory
private system prompt
scratchpad
skill registry
LangGraph checkpoint
```

into UAIR History unless an adapter deliberately exposes a specific durable
piece.

See `../agent/boundaries.md` and `../agent/compatibility-matrix.md`.
