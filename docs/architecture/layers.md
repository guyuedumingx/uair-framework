# UAIR Architecture Layers — v0.58

The repository contains many packages, but they do not have equal architectural
weight.

## Layer 1 — Runtime Core

Required conceptual foundation:

```text
@uair/core

Workflow
Component
Effect/History
durable replay
suspend/resume
Storage contract
workflow/history versioning
```

Core does not know:

```text
user
role
tenant
approval
OA
commerce
Agent framework
MCP server
React/Vue
secret manager
package registry
```

## Layer 2 — Runtime adapters

Replaceable infrastructure implementations:

```text
@uair/sqlite
@uair/postgres
```

An application needs a Storage implementation, but not every implementation.

## Layer 3 — Optional platform packages

Use only when the host needs them:

```text
@uair/ui
@uair/interaction
@uair/agent
@uair/mcp
@uair/package
@uair/security
@uair/sandbox
@uair/otel
@uair/ops
@uair/builder
@uair/forge
@uair/cli
```

These extend UAIR without redefining Runtime semantics.

Examples:

```text
personal local app
→ core + local storage

interactive local Agent
→ core + agent + ui/interaction

enterprise host
→ core + postgres + security + ops + selected adapters
```

## Layer 4 — Domain/reference packages

```text
@uair/oa
```

`@uair/oa` is not framework Core. Approval is a reference/domain scenario that
proves durable human workflow can be built on generic primitives.

Future packages may include commerce, asset, risk, CRM or third-party business
domains without requiring Core changes.

## Removal test

A useful architecture test is:

```text
remove OA        → UAIR still works
remove RBAC      → UAIR still works
remove MCP       → UAIR still works
remove Agent     → UAIR still works
remove Builder   → UAIR still works

remove Core      → UAIR no longer exists
```

## Repository rule

Do not add a concept to Core merely because one showcase needs it.

A new Core concept must be necessary for generic durable execution semantics,
not merely convenient for a domain, enterprise governance, Agent framework or
UI implementation.
