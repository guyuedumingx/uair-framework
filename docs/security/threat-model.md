# UAIR Threat Model — v0.55

This document defines security boundaries before UAIR is called production
grade.

## Assets

High-value assets include:

```text
Execution input/result
History
Suspension payloads and resolutions
Effect results
Interaction data
Agent/session references
Capability credentials
Package/plugin artifacts
release approvals
deployment/retirement state
tenant-scoped business data
```

## Trust boundaries

```text
client
  ↓
Gateway / authentication boundary
  ↓
UAIR host/runtime
  ↓
Component / Capability boundary
  ├─ existing APIs
  ├─ MCP
  ├─ Agent framework
  ├─ npm/package code
  └─ generated code
  ↓
external systems
```

Storage and queue systems are also independent trust/failure boundaries.

## Explicit non-trust assumptions

UAIR must not treat any of these as authorization:

```text
executionId
suspensionId
interactionId
workflow ID
surface kind
package name
client-supplied actor ID
model output
Agent tool request
MCP response
```

Authentication and tenant establishment happen in the host/Gateway.

## Primary threats

### Unauthorized interaction access

Attack:

```text
guess/obtain interactionId
→ read approval/business payload
→ resolve as another actor
```

Required control:

```text
server-side authorization on list/read/resolve
opaque ID alone is insufficient
```

### Duplicate/concurrent terminal actions

Attack/failure:

```text
two clients resolve differently
timer cancels while user resolves
duplicate webhook
```

Required control:

```text
optimistic revision/fence
one durable terminal winner
idempotent retries
```

### Replay / duplicate side effects

Attack/failure:

```text
retry/replay
→ charge twice
→ send twice
→ deploy twice
```

Required control:

```text
Effect identity/idempotency
legacy API idempotency adapter when upstream lacks it
```

### Untrusted Capability / MCP / plugin

Threats:

```text
SSRF
credential exfiltration
filesystem access
arbitrary network access
malicious package install
prompt/tool injection
supply-chain substitution
```

v0.55 reference controls:

```text
invocation-time Capability permission policy
MCP HTTP address/egress preflight policy
MCP stdio explicit process allowlist
sandbox boundary where applicable
package provenance + integrity + behavior evidence
durable raw-secret rejection / SecretRef pattern
```

Production OS/network isolation remains a Host responsibility.

### Sensitive data leakage

History/trace/log/metric data can contain:

```text
tokens
passwords
cookies
authorization headers
PII
business secrets
Agent private context
```

Required rule:

> Observability must never assume Runtime inputs are safe to export.

Before 1.0 UAIR needs a stable redaction policy and tests covering History,
traces and metrics.

### Agent state confusion

Threat:

```text
UAIR copies or rewrites external Agent memory/checkpoints
→ privacy leakage
→ context corruption
→ dual authority
```

Current boundary:

```text
Agent memory/context/skill/checkpoint stays framework-owned
UAIR stores only explicit/opaque references
```

### Version rollback against newer storage

Threat:

```text
old Runtime binary opens newer DB
→ silently corrupts new schema/state
```

Current control:

```text
Runtime storage schema version
fail closed when found > supported
```

### Cross-tenant access

Threat:

```text
tenant A guesses execution/suspension ID of tenant B
```

Required architecture:

```text
tenant established before UAIR storage/query access
tenant-scoped storage namespace or enforced database key
hostile cross-tenant tests
```

This remains a P0 item before multi-tenant production claims.

### Release authority confusion

Threat:

```text
coding model says "release"
→ production mutation
```

Current control:

```text
model output is not authorization
release and retire require explicit controller approval
```

## Security work still blocking 1.0

The first policy/reference layer above is now executable. Remaining security
release work is primarily environment/host integration:

```text
production Gateway authentication reference
real network sandbox/egress enforcement integration
real package-registry provenance verification in release environment
cross-tenant queue/Gateway/database integration test
secret-manager integration reference
```

The security helpers do not replace those external enforcement systems.
