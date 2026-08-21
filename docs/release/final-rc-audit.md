# Final Source Release Candidate Audit — v0.67

## Verdict

```text
Source tree:
READY

Public GitHub/npm publication:
WAITING FOR FINAL RELEASE ENVIRONMENT
```

## Source checks

Passed:

```text
clean dependency-ordered TypeScript build
full release:preflight
v1 API/DX audit
release-surface audit
source-RC audit
Architecture Governance
ProjectGraph / ChangeSet
Contract compatibility
Migration planning
Deployment planning/execution
ReleaseController
AI Builder self-extension
Codex Builder protocol/candidate compile
Package lifecycle/ecosystem
Interactive Agent reference
Agent compatibility boundary
Security hostile-boundary suite
SQLite concurrency/crash/fault gates
N-1/N/N+1 compatibility
create-uair first-run acceptance
npm pack --dry-run for publishable packages
documentation acceptance
```

## Release-surface findings fixed

### Repository hygiene

Added:

```text
.gitignore
.editorconfig
SECURITY.md
SUPPORT.md
GitHub CI
Issue templates
PR template
per-package npm README files
```

Stale duplicate top-level Agent/Adapter documents were removed.

### npm metadata

All publishable packages now have consistent:

```text
0.67.0 version
MIT license
description
Node >=22 engine
files/dist boundary
public scoped-package publishConfig
```

Real repository/homepage/bugs URLs are deliberately not fabricated.

### AI Builder provider normalization

Final preflight exposed a real semantic mismatch between deterministic Builder
and Codex Builder plans.

The generic Builder entry now normalizes capability plans against ProjectGraph
inventory:

```text
external package + public export
→ reuse

provider belongs to package being replaced
→ regenerate locally

"existing" without deterministic provider/export
→ do not trust; generate locally
```

This prevents AI-generated plans from silently declaring vague reuse that
cannot be imported or from redeclaring a durable ID already provided by another
package.

The Codex integration fixture now compiles a real cross-package provider reuse
candidate.

## Release tooling

Added:

```text
npm run release:metadata
npm run release:plan
npm run check:release-candidate-source
```

`release:metadata` stamps the real repository identity after the GitHub
repository exists.

`release:plan` computes the dependency-safe publish order and refuses release
when required metadata or lockfile is missing.

## Final macOS evidence

Observed on macOS with Node 24 and PostgreSQL 16:

```text
dependency-ordered workspace build: PASS
release:preflight: PASS
real PostgreSQL integration suite: PASS
50-cycle live resilience soak: PASS
uair lint against the real repository: PASS (0 errors, 0 warnings)
authenticated official Codex CLI invocation: PASS (read-only transport smoke)
```

The live gate uncovered and fixed PostgreSQL cluster-entry, test-clock and
requeued-job assignment consistency defects before publication.

The Codex evidence proves that the current host can reach the real authenticated
OpenAI backend through the official non-interactive CLI. The repository's
three-phase Builder protocol and generated-candidate compile remain covered by
the deterministic integration gate; the transport smoke does not grant release
authority and does not replace that protocol test.

## Intentionally unresolved before public publication

One source/publication identity prerequisite remains in this archive:

```text
1. repository/homepage/bugs metadata
```

It requires the final GitHub repository identity.

Resolve with:

```bash
UAIR_REPOSITORY_URL=https://github.com/ORG/REPO.git \
npm run release:metadata

npm run release:plan
```

`release:plan` must then return zero issues.

## Deferred environment evidence

Still intentionally deferred:

```text
long soak
mixed-binary rolling upgrade
real npm publication/provenance
live external Agent SDK integrations
real gateway/network sandbox
fresh external npm/create-uair smoke
```

The real PostgreSQL suite and a 50-cycle resilience soak are no longer
deferred. The soak is release-gate evidence, but it is not a substitute for an
overnight/long-duration soak.

These are evidence gates, not reasons to add new Runtime abstractions.
