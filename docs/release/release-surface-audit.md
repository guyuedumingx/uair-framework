# Release Surface Audit — v0.66

This audit reviews the remaining pre-alpha surface after the v0.65 API/DX
freeze work.

The rule remains:

```text
prefer classification, deletion and clearer boundaries
over new Runtime abstractions
```

## Result

```text
new Core primitives:                  0
new CLI commands:                     0
new package manager concepts:         0
required package merges before alpha: 0
required example deletions:           0
```

## 1. Security / self-extension authority

The self-extension path has three distinct decisions:

```text
Builder proposal
→ operator approval
→ security/trust enforcement
```

They must not collapse into one boolean.

`ExtensionController.apply(true)` means:

```text
the operator authorized the proposed release action
```

It does not mean:

```text
the package is trusted
the source is authentic
the package may access every capability
the package may bypass sandbox policy
```

Production acquisition remains responsible for:

```text
package trust
provenance
sandbox/isolation
capability authorization
tenant boundary
secret policy
```

The receipt-only CLI adapter is for local/reference flows and must not be
presented as a production security boundary.

Decision:

```text
no new Core authorization primitive
no implicit "AI approved itself" path
keep operator approval separate from security policy
```

## 2. Agent adapter compatibility

`@uair/agent` owns only a small integration layer:

```text
agent()
asAgentTool()
llm()
externalAgent()
durableWorkflowTool()
```

UAIR does not own an external framework's:

```text
memory
checkpoint/context state
model routing
skill registry
tool policy
prompt lifecycle
```

Compatibility direction remains bidirectional:

```text
UAIR Workflow → external Agent
external Agent → UAIR Workflow
```

Decision:

```text
do not add provider-specific Agent concepts to Core
do not persist foreign Agent internals as UAIR History semantics
```

## 3. Package count

The repository currently contains focused packages for:

```text
core
ui
interaction
agent
mcp
package
builder
cli
security
sandbox
postgres
sqlite
otel
ops
oa
forge
create-uair
```

Package count alone is not a reason to merge.

### Keep separate

```text
postgres / sqlite
→ optional storage adapters with different dependencies/operational behavior

otel
→ optional observability projection

security / sandbox
→ policy vs isolated acquisition/execution boundary

oa
→ reference domain package, not Runtime

create-uair
→ zero-friction bootstrap executable
```

### Watch, but do not merge before alpha

```text
forge
→ small and experimental; may eventually become Builder-internal

ops
→ small host-operability package; merge only if real users never consume it
  independently

interaction / ui
→ adjacent but semantically different: transport/event intake vs rendering
  and durable human interaction
```

Premature merging would increase mandatory dependency weight and couple
independent release surfaces.

## 4. Examples

Examples are classified rather than deleted blindly.

### Golden-path examples

```text
basic
playground
conversational-agent
oa-showcase
enterprise
```

These explain how users build applications.

### Reliability / adapter fixtures

```text
capacity-reservation
chaos-harness
job-queue-spi
postgres-integration
process-crash-harness
reliable-queue
routing
shared-registry
versioning
interaction-oa-server
```

These primarily exist as executable architecture/reliability evidence.

Decision:

```text
keep them in the repository for alpha
do not present every fixture as a beginner tutorial
```

A future repository split may move reliability fixtures under an internal test
area, but doing so now has little user-facing benefit.

## 5. CLI complexity

The user-facing CLI is grouped into four jobs:

```text
Author
  build
  review

Govern
  lint
  impact
  graph

Release
  status
  extensions
  extend
  release
  retire

Package
  package create/verify/pack/catalog/status/install/upgrade/rollback/publish
```

No additional top-level command is required.

Package lifecycle operations remain nested under:

```text
uair package ...
```

CLI errors must point users back to `uair help` when the command/subcommand is
invalid.

## 6. Error model

UAIR does not need a universal error-class hierarchy before alpha.

Typed errors are justified at policy boundaries where callers need to branch:

```text
PermissionDeniedError
CapabilityPermissionDeniedError
PackageProvenanceError
RawSecretPersistenceError
```

Simple authoring/configuration failures may remain ordinary `Error` with
actionable messages.

Do not create dozens of framework-specific error classes merely for taxonomy.

## 7. Experimental marking

Explicitly provisional:

```text
@uair/core/cluster
@uair/forge
Builder exact interfaces
sandbox manifest exact shape
deployment adapter exact shape
raw History schema
physical storage schema
```

The application API must not imply compatibility guarantees for these surfaces.

## Release recommendation

After this audit, no additional conceptual subsystem is required before the
deferred real-environment validation stage.

Remaining source-only work should be limited to:

```text
bug fixes
documentation contradictions
security boundary defects
compatibility regressions
release automation defects
```

A feature request that requires a new Core primitive should now be presumed
rejected until real usage demonstrates that the existing six-part model cannot
express it.
