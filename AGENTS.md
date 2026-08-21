# AGENTS.md

Read these before changing this repository:

1. `docs/architecture/layers.md`
2. `docs/architecture/core-principles.md`
3. `docs/concepts/durable-identity.md`
4. `AI_AUTHORING_GUIDE.md`
5. `docs/maintainers/durable-contracts.md`

Hard rules:

```text
Core stays small.
Approval/OA is not Core.
Agent memory/skills are not UAIR state by default.
Ordinary TypeScript stays ordinary TypeScript.
Durable identity is explicit and stable.
Initial Workflow version is implicit 1.
Security/tenant/IAM are outer policies.
Use existing packages/adapters before inventing Core abstractions.
Never claim an environment-dependent test passed unless it was executed.
```

If a requested change conflicts with these rules, implement it at the nearest
outer package/adapter/host layer unless generic durable correctness proves a
Core change is necessary.


Before completing architecture-affecting work:

```text
uair lint
uair impact <changed durable node>
```

Hard governance errors must not be bypassed. Warnings require reasoning, not
automatic refactoring.
