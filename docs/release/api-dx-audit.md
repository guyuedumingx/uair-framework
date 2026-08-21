# API / DX / Concept Audit

This document records the pre-v1 review of UAIR's authoring surface.

The goal is reduction and clarity, not new primitives.

## Result

```text
Core primitive additions required: 0
Core primitive removals required: 0

Main remaining risk:
public/documentation surface complexity outside Core
```

## Daily authoring surface

A normal application author should be able to stay inside:

```text
workflow()
component()

surface()
input()
choose()
present()

normal TypeScript
```

The common case should not require knowledge of:

```text
History record shapes
deployment fingerprints
cluster queues
worker registries
storage fencing
release receipts
package provenance internals
```

## Stable identity

Required:

```text
Workflow stable ID
Component stable ID
Capability public ID
```

Not required for ordinary first-version Workflow code:

```text
explicit version "1"
```

The default remains:

```text
version = "1"
```

The stable ID is not a magic configuration value. It is persisted protocol
identity and must survive harmless source refactors.

## Workflow advanced metadata

`WorkflowOptions` still supports:

```text
deploymentId
fingerprint
```

These are advanced host/deployment metadata.

They remain available for compatibility/tooling, but ordinary Workflow authors
should not set them manually.

Preferred authoring:

```ts
workflow(
  "commerce.checkout",
  async input => {
    ...
  }
);
```

Versioned authoring:

```ts
workflow(
  "commerce.checkout",
  {
    version:
      "2"
  },
  async input => {
    ...
  }
);
```

## UI API convergence

Preferred API:

```text
surface()
input()
choose()
present()
```

Compatibility API:

```text
ui()
displayUi()
```

The compatibility API remains exported during v0.x but is deprecated and should
not appear in new-user examples.

Conceptually:

```text
surface/input/choose
→ blocking durable wait

present
→ non-blocking display
```

This is the single UI mental model for new code.

## RuntimeEngine

`RuntimeEngine` remains part of the reviewed v1-alpha root API because server
hosts need event delivery/resume orchestration.

However it is not required for a minimal one-shot application:

```ts
run(
  workflow,
  input,
  storage
);
```

New-user documentation should teach `run()` first and introduce
`RuntimeEngine` only in hosting/event-driven examples.

## Public API tiers

### Tier 1 — application authoring

```text
@uair/core
@uair/ui
@uair/agent
@uair/interaction
@uair/package
```

### Tier 2 — advanced runtime adapters

```text
@uair/core/runtime
```

### Tier 3 — experimental cluster hosting

```text
@uair/core/cluster
```

### Tier 4 — internal implementation

```text
@uair/core/internal
```

No application should depend on Tier 4.

## Packages are not Core concepts

The repository has many packages, but this must not become a large user mental
model.

Most applications should install only what they need.

Examples:

```text
local durable app
→ @uair/core

interactive app
→ @uair/core + @uair/ui

Agent app
→ @uair/core + @uair/agent

enterprise shared storage
→ add @uair/postgres

AI-authored system
→ tooling adds @uair/builder / @uair/cli
```

## Terms intentionally rejected from Core

The audit found no reason to add:

```text
Domain
Team
Owner
Approval
Role
Tenant
Memory
Skill
Package
Agent
Surface
Deployment
```

as new Runtime Core primitives.

These remain composition/tooling/application concepts over the existing
durability kernel.

## README policy

The root README is current-product documentation.

Historical version-by-version descriptions belong under:

```text
docs/archive/
CHANGELOG.md
```

The README must not become a development diary.

## Release-freeze recommendation

Candidate for v1 compatibility:

```text
workflow()
component()
parallel()
race()
run()
resume()
RuntimeEngine

WorkflowDefinition
Component
ComponentContext
ComponentOptions
RetryPolicy
SuspendOptions
Execution
ExecutionStatus
PreviousResult
```

Preferred UI surface is also stable enough conceptually:

```text
surface()
input()
choose()
present()
SurfaceSpec
SurfaceAction
```

Still provisional:

```text
Builder interfaces
Capability ranking
package lifecycle receipt exact shape
cluster scheduling API
raw History schema
physical storage schema
sandbox manifest shape
deployment adapter exact shape
```

Freezing these provisional interfaces too early would make future maintenance
harder.

## Decision

Before public alpha:

```text
do not add more Core concepts
do not add another UI abstraction
do not infer durable IDs
do not require explicit initial version
do not create a proprietary package manager
do not freeze Builder/cluster internals as v1 application API
```

The framework should become easier primarily by hiding advanced layers and
improving defaults/documentation, not by weakening durable correctness.
