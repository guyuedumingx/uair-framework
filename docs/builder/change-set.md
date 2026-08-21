# UAIR ChangeSet — v0.45

`ChangeSet` is the structural difference between two UAIR `ProjectGraph`s.

It is not a line-based Git diff. It reasons about stable application identities:

```text
Package
Workflow
Component
Capability
Surface
```

## Symbol-level dependency graph

v0.45 uses the TypeScript compiler API instead of regular-expression-only scanning.

For:

```ts
import {
  checkBalance
} from "./components.js";

export const leave =
  workflow({
    id:
      "hr.leave.request",
    version:
      "2",

    async run(input) {
      await checkBalance();

      return surface({
        kind:
          "hr.leave.director-approval",
        data: {
          input
        }
      });
    }
  });
```

ProjectGraph records:

```text
workflow:hr.leave.request
  ├─ uses → component:leave.balance.read
  └─ uses → surface:hr.leave.director-approval
```

Relative imported symbols are resolved with the TypeScript TypeChecker.

## Fingerprints

Every semantic node can carry an implementation fingerprint.

Identity remains:

```text
hr.leave.request
```

Fingerprint answers a different question:

```text
did its implementation change?
```

This catches the unsafe case:

```text
before:
hr.leave.request@2
input.days > 3

after:
hr.leave.request@2
input.days > 2
```

The ID and version are identical, but the fingerprint changes.

## ChangeSet

```ts
const changeSet =
  createChangeSet(
    beforeGraph,
    afterGraph
  );
```

Each item is:

```text
ADD
MODIFY
REMOVE
```

and contains reverse dependency impact.

Example removal:

```text
REMOVE
component:leave.balance.read

affected:
workflow:hr.leave.request
package:@acme/leave
```

## Safety analysis

```ts
const safety =
  analyzeChangeSetSafety(
    changeSet
  );
```

Current hard errors:

```text
WORKFLOW_IMPLEMENTATION_CHANGED_WITHOUT_VERSION_BUMP

REMOVAL_HAS_DEPENDENTS
```

Safe version evolution:

```text
Workflow hr.leave.request
v2 → v3
```

produces informational evidence:

```text
WORKFLOW_VERSION_ADVANCED
```

## Builder integration

Project-aware Builder automatically performs:

```text
existing ProjectGraph
↓
generate candidate artifacts
↓
materialize candidate into isolated temp project
↓
candidate ProjectGraph
↓
ChangeSet
↓
ChangeSet safety
↓
Runtime Impact
↓
Release Proposal
```

An unsafe ChangeSet blocks the Builder Workflow before a Release Proposal is created.

## Runtime Impact vs ChangeSet

They answer different questions.

```text
ChangeSet
→ What code/semantic identities are changing?
→ Who depends on them?

Runtime Impact
→ Which durable executions are alive right now?
→ Which versions/suspensions still depend on old code?
```

A release decision needs both.

## Current limitations

v0.45 resolves local/relative TypeScript symbols and package imports. It does not yet provide:

```text
full monorepo package export resolution for every build system
dynamic computed capability IDs
runtime-generated Surface kinds
semantic data-shape compatibility checking
database/schema migration diff
```

Those should be added as development-layer analyzers, not Runtime Core primitives.
