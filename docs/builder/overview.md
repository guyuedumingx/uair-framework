# UAIR Builder v0.43

UAIR Builder is the development layer that lets AI create stable UAIR business software.

It is intentionally separate from Runtime Core.

```text
Human requirement
↓
Builder Workflow
↓
Business Spec
↓
Build Plan
↓
Artifacts
↓
Verification
↓
Impact Analysis
↓
Preview Manifest
↓
Release Proposal
```

Publishing and production deployment are separate authorized actions.

## Builder is itself a UAIR Workflow

```ts
const builder =
  createBuilderWorkflow({
    inspector,
    analyst,
    architect,
    implementer,
    verifier,
    impact,
    preview,
    release
  });

const execution =
  await run(
    builder,
    {
      description:
        "做一套请假系统",
      companyScope:
        "acme"
    },
    storage
  );
```

This means the software-development process can itself be durable.

## Phases

### ProjectInspector

Reads the current project/application ecosystem:

```text
packages
capabilities
workflows + versions
surfaces
```

A production implementation can extend this with Runtime metadata, Git, npm registry information and deployment state.

### RequirementAnalyst

Converts natural-language business requirements into `BusinessSpec`.

A real LLM belongs here.

### SolutionArchitect

Produces a `BuildPlan`:

```text
Workflow IDs
Component IDs
Surface kinds
capability reuse/generation decisions
files
tests
```

### ArtifactImplementer

Produces reviewable files:

```text
package.json
Workflow source
Component source
Surface contracts
tests
tsconfig
exports
```

A coding model belongs behind this interface.

### ArtifactVerifier

Verifies the generated artifacts.

The v0.43 reference implementation performs structural verification; the executable Builder check additionally materializes the generated package and compiles it with TypeScript.

Production verification should add:

```text
unit tests
durability tests
static analysis
dependency audit
sandbox execution
security checks
```

### ImpactAnalyzer

Examines whether the requested change collides with durable Workflow identities.

For an existing workflow, Builder should recommend creating a new Workflow version rather than silently replacing deployed code.

### PreviewBuilder

Creates a product-facing preview manifest:

```text
entry Workflow
Surfaces
Capabilities
demo scenarios
```

### ReleasePlanner

Produces a `ReleaseProposal`.

It does **not** publish automatically.

## Deterministic reference implementation

v0.43 ships deterministic implementations for one reason:

> Builder protocol and runtime behavior must be testable independently of model randomness.

For the requirement:

```text
所有请假直属经理审批；
超过3天部门负责人追加审批；
余额不足不能提交；
审批后写入考勤并审计。
```

with existing capabilities:

```text
employee.lookup
audit.append
```

Builder produces:

```text
package:
@acme/leave

workflow:
hr.leave.request

reuse:
employee.lookup
audit.append

generate:
leave.balance.read
attendance.update

surfaces:
hr.leave.form
hr.leave.manager-approval
hr.leave.director-approval
```

Artifacts:

```text
package.json
src/workflows/leave.ts
src/components/index.ts
src/surfaces.ts
src/index.ts
test/leave.test.ts
tsconfig.json
```

The generated package is then materialized to disk and TypeScript compiled.

## Real AI integration

Do not replace Builder with one giant unrestricted coding Agent.

Instead replace phase implementations:

```text
RequirementAnalyst
→ reasoning model

SolutionArchitect
→ reasoning/model + ProjectGraph

ArtifactImplementer
→ coding model

ArtifactVerifier
→ deterministic tools + optional reviewer model

ImpactAnalyzer
→ Runtime/project metadata + deterministic rules

ReleasePlanner
→ deterministic release policy
```

The outer Builder Workflow remains fixed.

## Artifact materialization

```ts
await materializeArtifacts(
  outputDir,
  proposal.artifacts
);
```

The writer rejects path traversal outside the target directory.

## Current limitation

v0.43 does not yet:

```text
read a real Git repository into a ProjectGraph
call a real coding model
run a production sandbox
publish npm packages
deploy to production
query active Runtime executions for change impact
```

Those are next-layer integrations, not missing Runtime primitives.

## Product direction

```text
Describe
→ Build
→ Verify
→ Preview
→ Approve
→ Publish
→ Run
→ Improve
```

The ecosystem grows through company packages and capabilities while UAIR Runtime Core remains small.


## v0.44 — existing-system awareness

Builder can now inspect real UAIR source projects:

```ts
const defaults =
  createProjectAwareBuilderDefaults(
    projectRoot,
    runtimeStorage
  );
```

This combines:

```text
FsProjectGraphInspector
+
DurableRuntimeImpactAnalyzer
```

### Project evidence

For an existing package:

```text
@acme/leave@1.2.0

Workflow
hr.leave.request@2

Component
leave.balance.read

Surface
hr.leave.manager-approval
```

Builder discovers the inventory directly from source.

### Runtime evidence

Given durable Runtime state:

```text
hr.leave.request@2
  1 running
  1 suspended

hr.leave.request@1
  1 completed
```

the Impact Analyzer reports:

```text
activeExecutionRisk = high

activeExecutions = 2
suspendedExecutions = 1

observed versions:
1, 2
```

and recommends:

```text
Publish a new Workflow version.
Preserve old deployment compatibility until active executions drain
or are explicitly migrated.
```

### Automatic version evolution

When the user requests:

```text
“把超过3天需要部门负责人审批改成超过2天”
```

Builder sees:

```text
current source:
hr.leave.request@2

live executions:
2 active
1 suspended
```

and produces:

```text
target:
hr.leave.request@3
```

The generated Workflow source contains both:

```ts
version: "3"
```

and:

```ts
if (
  input.days > 2
) {
  ...
}
```

It does not overwrite v2.

This is the intended distinction between ordinary AI code generation and UAIR-managed software evolution.


## v0.45 — symbol graph + ChangeSet release gate

Builder now analyzes real TypeScript symbol usage.

Example:

```text
hr.leave.request
├─ uses leave.balance.read
└─ uses hr.leave.director-approval
```

This enables dependency-aware change governance.

Project-aware Builder now automatically:

```text
scan current project
↓
generate candidate artifacts
↓
overlay candidate in isolated temp project
↓
scan candidate project
↓
create ChangeSet
↓
analyze ChangeSet safety
↓
analyze live Runtime impact
↓
create Release Proposal
```

The Proposal contains:

```text
changeSet
changeSafety
impact
```

Unsafe implementation change:

```text
hr.leave.request@2
>3 days → >2 days
without version bump
```

is rejected with:

```text
WORKFLOW_IMPLEMENTATION_CHANGED_WITHOUT_VERSION_BUMP
```

Safe evolution:

```text
hr.leave.request@2
→ hr.leave.request@3
```

passes.

Deleting a still-used Component is blocked with:

```text
REMOVAL_HAS_DEPENDENTS
```

See `change-set.md`.


## v0.46 — Contract Graph + durable payload compatibility

Builder now projects ordinary TypeScript into analysis-only boundary contracts.

It can detect:

```text
Component input narrowing
Component output breakage
Surface data narrowing
Surface action narrowing
pending durable Surface payload incompatibility
```

Example:

```text
old Surface data:
employeeId
days

new Surface data:
employeeId
days
departmentId (required)
```

If an unresolved production Suspension still contains the old payload, Builder returns:

```text
SURFACE_DATA_CONTRACT_NARROWED
PENDING_SURFACE_PAYLOAD_INCOMPATIBLE
```

and blocks the release.

A safe project-aware proposal now carries three independent evidence layers:

```text
changeSafety
contractCompatibility
impact
```

For the v2 → v3 leave-system evolution fixture:

```text
ChangeSet safety:
SAFE

Contract compatibility:
COMPATIBLE

pending Surface payloads checked:
1 / 1 compatible

Runtime impact:
HIGH
because 2 executions are still active,
including 1 suspended execution.
```

High Runtime impact does not automatically mean incompatible. It means the old deployment/version must remain routable while those executions drain or are explicitly migrated.

See `contract-graph.md`.


## v0.47 — Migration Planner

Builder now distinguishes:

```text
incompatible
```

from:

```text
unreleasable
```

If a new Workflow version can be isolated from old durable executions, Builder can safely select:

```text
version-isolation
```

For the current leave-system fixture:

```text
current:
hr.leave.request@2

candidate:
hr.leave.request@3

active:
2

suspended:
1

selected migration:
version-isolation

releaseAllowed:
true
```

The migration plan explicitly requires:

```text
keep v2 registered
keep old deployment recoverable
route new executions to v3
let old v2 executions drain
do not rewrite History
```

Release Proposal now carries:

```text
changeSet
changeSafety
contractCompatibility
runtime impact
migrationPlan
```

See `migration-planner.md`.


## v0.48 — Deployment Planner

Builder now produces a deployment plan after migration planning.

```text
deploy
→ cutover
→ retain
→ retire
```

For the leave-system fixture:

```text
target:
hr.leave.request@3

previous:
hr.leave.request@2
deploy-leave-v2

releaseAllowed:
true

retireGate:
ready = false
active = 2
suspended = 1
```

The release can cut over new executions to v3 immediately, while v2 stays available for pinned executions.

When fresh Runtime Impact reaches:

```text
running = 0
suspended = 0
```

`evaluateRetireGate()` returns:

```text
ready = true
```

Only then may an authorized deployment adapter retire v2.

Release Proposal now carries:

```text
changeSet
changeSafety
contractCompatibility
impact
migrationPlan
deploymentPlan
```

See `deployment-planner.md`.


## v0.49 — Release Controller + CLI

The analysis/planning pipeline is now operable.

```text
build
→ review
→ release
→ status
→ retire
```

Release Controller is independent of the CLI and consumes the verified Release Proposal.

State-changing actions require explicit authorization.

Retirement uses fresh Runtime evidence and only counts executions pinned to the old Workflow version, avoiding the bug where new-version traffic could indefinitely block old deployment cleanup.

See `release-controller.md` and `../reference/cli.md`.


## v0.50 — Codex backend

The Builder's AI-facing phases can now be backed by the official Codex CLI.

```text
Codex
├─ RequirementAnalyst
├─ SolutionArchitect
└─ ArtifactImplementer

UAIR deterministic gates
├─ ArtifactVerifier
├─ ChangeSet
├─ Contract Compatibility
├─ Runtime Impact
├─ Migration Planner
├─ Deployment Planner
└─ Release Controller
```

Create:

```ts
createCodexBuilderDefaults(
  projectRoot,
  storage,
  {
    binary:
      "codex",
    model:
      "gpt-5.6-sol"
  }
);
```

Codex structured output is constrained with per-phase JSON Schema and `codex exec --output-schema`.

No AI phase receives release/retirement authorization.

See `codex-backend.md`.
