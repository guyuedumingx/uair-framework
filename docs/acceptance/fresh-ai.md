# Fresh AI Acceptance

Purpose: verify that a coding agent with no prior conversation/history can
modify a UAIR project safely from repository instructions alone.

## Setup

Use a fresh session of Codex, Claude Code or another coding agent.

Give it only the repository and this task. Do not paste architecture advice from
previous UAIR development conversations.

## Task

Implement a device-request business package:

```text
requester submits a device need
→ inventory Component checks availability
→ if stock exists, requester chooses an available device
→ if stock does not exist, an external purchasing request is created
→ later purchasing webhook/event resumes the Workflow
→ final assignment is persisted
```

Add a human review only if the package's own policy requires it.

## Critical architectural expectations

The agent should discover from repository documentation that:

```text
Inventory / purchasing / assignment
→ domain package/components

user choice / external response
→ Interaction/Suspension

pure mapping/calculation
→ ordinary TypeScript

Security/Tenant
→ optional host package, not Core

Approval
→ not a Core primitive
```

## Hard fail

The solution fails if the agent:

- adds `Approval`, `Device`, `Inventory`, `User`, `Tenant` or `Skill` primitives
  to `@uair/core`;
- copies Agent memory/skills into UAIR History without an explicit reason;
- removes/renames durable IDs during unrelated refactors;
- builds a second durable state machine beside UAIR;
- bypasses release/compatibility/security gates;
- treats model output as release authorization.

## Pass criteria

- no Core changes are necessary;
- new code lives in a package/example;
- stable IDs are semantic and minimal;
- initial Workflow version remains implicit unless evolution requires otherwise;
- existing UAIR packages are reused before new abstractions are invented;
- compile/tests pass;
- the agent can explain why each UAIR boundary is durable.

## Evaluation output

Ask the coding agent to finish with:

```text
files changed
architecture decisions
durable IDs introduced
why each Component is durable
why each pure helper is not a Component
Core changes: none / justification
tests run
environment-dependent tests not run
```

Keep this output as release evidence.
