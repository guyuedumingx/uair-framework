# Architecture Governance

UAIR architecture governance is tooling, not Runtime Core.

It exists to keep large human + AI maintained projects understandable without
turning architecture conventions into durable execution primitives.

## Hard errors

These indicate objectively unsafe or structurally ambiguous project state:

```text
DUPLICATE_DURABLE_ID
PACKAGE_DEPENDENCY_CYCLE
WORKFLOW_DEPENDENCY_CYCLE
CROSS_PACKAGE_PRIVATE_IMPORT
```

A Builder-generated candidate containing a hard error is rejected before a
release proposal is produced.

`uair lint` also exits non-zero.

## Warnings

Warnings are architecture smells, not universal correctness failures:

```text
HIGH_WORKFLOW_FAN_OUT
DEEP_WORKFLOW_CHAIN
PACKAGE_NAMESPACE_MISMATCH
```

Defaults:

```text
direct Workflow uses > 15
Workflow dependency depth > 8
```

Thresholds are policy defaults, not Runtime limits.

A project can deliberately exceed them with architectural justification.

Package namespace checks are opt-in because different organizations have
different naming conventions.

## Informational hotspots

A durable node with many dependents may be reported as:

```text
ARCHITECTURE_HOTSPOT
```

This does not mean the design is wrong. It tells maintainers that changes to the
node deserve broader review and impact testing.

## CLI

```bash
uair lint
```

Runs deterministic governance checks.

```bash
uair impact payment.charge
```

Shows direct/transitive dependents and dependency paths.

```bash
uair graph
```

Prints Mermaid.

```bash
uair graph --output architecture.mmd
```

Writes a visualization artifact suitable for PRs and documentation.

## Builder integration

Project-aware Builder candidates are automatically checked.

The candidate model is a **complete package replacement**, not a blind overlay
on stale files. This matters when code is reorganized: moving
`commerce.checkout` from one file to another must not create an artificial
duplicate declaration during analysis.

## What governance intentionally does not do

It does not add:

```text
Domain
Team
Owner
BoundedContext
Approval
Tenant
Service
Namespace
```

to Runtime Core.

Ownership and repository policies belong to packages, Git/code review systems,
CI and organization-specific tooling.

## Design goal

```text
correct architecture
→ easy

architecture smell
→ visible

objective structural conflict
→ blocked

business/domain choice
→ remains the team's decision
```
