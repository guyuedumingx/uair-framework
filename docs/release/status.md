# UAIR Current Release Status — v0.67

## Decision

```text
Source Release Candidate:
READY

GitHub/npm public release:
BLOCKED BY REPOSITORY IDENTITY + GIT/NPM RELEASE AUTHORITY + REMAINING EXTERNAL GATES

Production-grade 1.0:
NOT YET
```

v0.67 is the final source-release hardening pass. It adds no Runtime Core
primitive.

## Source release surface

Completed:

```text
MIT LICENSE
.gitignore / .editorconfig
SECURITY / SUPPORT policy
Issue templates
PR template
base GitHub CI
package READMEs
package engines
public scoped publishConfig
versioning policy
breaking-change policy
publishing procedure
deterministic publish order
release metadata stamping
final release checklist
```

## Intentionally unresolved repository identity

UAIR does not embed fake GitHub URLs.

Once the real repository exists:

```bash
UAIR_REPOSITORY_URL=https://github.com/ORG/REPO.git \
npm run release:metadata
```

This stamps:

```text
repository
homepage
bugs
```

into the root and publishable package metadata.

## Lockfile

A root `package-lock.json` has been generated with Node 24 in a networked macOS
environment.

It still needs to be committed after this source archive is attached to the
real Git repository:

```bash
git add package-lock.json
```

After that, CI uses `npm ci`.

## Release plan

Run:

```bash
npm run release:plan
```

It must report zero issues and prints the dependency-safe npm publication order.

The plan checks:

```text
synchronized package version
MIT license
description
files/dist
Node engine
public scoped publishConfig
repository/homepage/bugs
package-lock presence
internal dependency cycles/order
```

## Compatibility state

The candidate v1 application API remains centered on:

```text
workflow
component
parallel
race
run
resume
RuntimeEngine
```

Preferred UI authoring:

```text
surface
input
choose
present
```

Still provisional/experimental:

```text
@uair/core/cluster
@uair/forge
Builder exact interfaces
sandbox manifest exact shape
deployment adapter exact shape
raw History schema
physical storage schema
```

## Core freeze

v0.67 adds no Core primitive or semantic subsystem.

The only remaining work before a public alpha is release/environment evidence,
not architecture expansion.

## Deferred final evidence

```text
long soak
mixed-binary rolling upgrade
real npm registry publication/provenance
live external Agent SDK adapters
real gateway/network sandbox
fresh external create-uair smoke
```

Completed final-environment evidence:

```text
live PostgreSQL 16 integration suite
50-cycle PostgreSQL + local resilience release gate
real-repository architecture governance CLI
```

See:

```text
docs/release/checklist.md
docs/release/publishing.md
docs/release/mac-validation.md
```


## Builder bootstrap boundary

Verified:

```text
create-uair
→ minimal project
→ Builder project inspection
→ first business candidate generation
→ verification/governance proposal
```

The current implementation is therefore **bootstrap-capable**, but not yet a
fully autonomous continuous product-development loop.

Specifically:

```text
automatic source promotion: false
autonomous repeated goal loop: false
approval bypass: false
```

A coding Agent can repeatedly invoke Builder and process accepted candidates,
but today the framework deliberately keeps candidate promotion and
extension/release authorization explicit.

See `docs/builder/bootstrap.md`.
