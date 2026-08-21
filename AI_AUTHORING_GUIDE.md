# AI Authoring Guide for UAIR

This file is written for coding agents modifying UAIR applications or the UAIR
repository.

## Default rules

1. Do not add domain concepts to `@uair/core`.
2. Use normal TypeScript functions for pure/in-process computation.
3. Use `component(id, ...)` only for durable external-operation boundaries.
4. Use `workflow(id, ...)` for long-running durable orchestration.
5. Never infer, rename or regenerate a durable ID during a refactor.
6. Initial Workflow version is implicit `"1"`; bump version only for a real
   durable evolution boundary.
7. Do not copy Agent memory, prompts, checkpoints or skills into UAIR History by
   default.
8. Prefer existing npm/package/MCP/capability integrations before generating a
   new implementation.
9. Security/IAM/Tenant/Secret management belong to outer packages/host policy.
10. Approval/OA is a domain/reference package, not a Core primitive.
11. Do not introduce node-type DSLs when ordinary TypeScript composition works.
12. Do not bypass deterministic compatibility/release gates because a model
   believes a change is safe.

## When modifying Core

Before adding a Core primitive, prove:

```text
generic durable correctness requires it
AND
at least several unrelated domains need the same semantic
AND
existing primitives cannot express it safely
```

Otherwise implement the feature in an adapter/package.

## When changing durable code

Check:

```text
Workflow ID
Workflow version
History schema
Storage schema
Surface/Interaction contract
migration
rollback
old suspended Executions
```

## When adding a package

Use npm semantics. Add:

```text
clear package role
public export contract
tests
trust/security metadata where relevant
documentation
```

## Before completing a task

Run the smallest relevant gates first, then broader release gates when the
change touches durable/public behavior.


## Architecture governance

Before proposing a package/release change, use deterministic ProjectGraph
governance.

```text
duplicate durable ID
package cycle
Workflow cycle
cross-package private import
→ hard failure

high fan-out
deep Workflow chain
hotspot
→ review signal, not automatic failure
```

Do not “fix” a warning by inventing more Workflows or Core primitives. Explain
the tradeoff first.


## Package lifecycle

When a new capability is needed:

```text
reuse existing project provider
→ discover trusted installable package
→ generate only if still missing
```

Do not invent a second package manager or registry.

For package changes, use the same lifecycle as a human maintainer:

```text
verify
→ pack
→ publish proposal
```

Do not publish or install packages merely because model output recommends it.
Those actions require explicit host/operator authorization and applicable trust
policy.
