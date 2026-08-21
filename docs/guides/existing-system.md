# Integrate an Existing System

Do not rewrite a healthy existing frontend/backend system merely to adopt UAIR.

Typical architecture:

```text
React/Vue
   ↓
existing Gateway/API
   ↓
existing Java/Go/Node services
   ↓
existing databases
```

Add UAIR beside the current system and migrate only workflows that benefit from:

```text
durable long-running execution
human interaction
Agent orchestration
reliable side effects
external-event resume
```

Existing APIs become Components.

The main migration hazards are:

```text
double workflow ownership
non-idempotent side effects
missing correlation IDs
incorrectly splitting local DB transactions
```

At any time, one long-running process should have one authoritative
orchestrator.
