# UAIR Adapter Compatibility Policy — v0.58

UAIR Core remains deliberately small. Production integration therefore depends
on stable outer adapter contracts.

## Policy before 1.0

During `0.x`, minor versions may still make breaking changes, but every release
must:

```text
declare adapter contract changes in CHANGELOG
keep one machine-readable public export snapshot
run the snapshot in release preflight
avoid accidental deep-import contracts
```

The v0.58 snapshot is:

```text
compat/adapter-api-v067.json
```

It covers the intentionally public integration surfaces for:

```text
@uair/mcp
@uair/security
@uair/package
@uair/sqlite
@uair/postgres
@uair/interaction
@uair/agent
@uair/otel
@uair/ops
```

## 1.0 policy

Starting at 1.0:

```text
PATCH
→ bug fix; no intentional public contract break

MINOR
→ additive compatible public API

MAJOR
→ public API removal/behavioral incompatibility allowed with migration notes
```

Durable contracts are stricter than ordinary TypeScript APIs:

```text
Workflow ID/version
History schema
Surface/Interaction payload contract
Execution storage schema
```

These are governed by their dedicated compatibility gates and cannot be made
unsafe merely by a semver bump.

## Deep imports

Consumers must use declared package exports.

Internal source files and undeclared `dist/*` paths are not compatibility
contracts.

## Adapter ownership

Adapters may translate boundaries but must not steal state ownership from the
external system they integrate:

```text
Agent memory/checkpoint
MCP server state
database transaction semantics
IAM identity
secret manager contents
```

Compatibility tests check the UAIR-facing API; provider-specific live tests
remain required where external runtimes are involved.
