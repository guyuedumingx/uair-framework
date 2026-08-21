# UAIR Release Controller — v0.61

v0.49 converts Builder release evidence into an operable release lifecycle.

The reusable control logic lives in:

```text
@uair/builder
ReleaseController
```

The command-line shell lives in:

```text
@uair/cli
```

This separation is deliberate. A future Web console, CI pipeline, GitHub Action, or enterprise control plane can call the same Controller.

## Lifecycle

```text
build
↓
review
↓
release --approve
↓
status
↓
old executions drain
↓
retire --approve
```

Release and retirement are distinct privileged actions.

## State

Release Controller stores:

```text
.uair/release/release-state.json
```

including:

```text
ReleaseProposal
in-progress release attempt/checkpoints
release/rollback evidence
retirement receipts
```

The proposal already contains:

```text
ChangeSet
Change Safety
Contract Compatibility
Runtime Impact
Migration Plan
Deployment Plan
```

The Controller does not recompute policy in an ad-hoc way. It consumes these verified artifacts.

## Explicit authorization

The Controller rejects:

```text
release
```

unless the caller explicitly authorizes it.

The CLI expresses this as:

```bash
uair release --approve
```

The same applies to retirement:

```bash
uair retire --approve
```

This keeps build/review actions separate from state-changing release actions.

## Release gate

Release is blocked unless:

```text
DeploymentPlan.releaseAllowed = true
DeploymentPlan.verification.passed = true
ChangeSet safety = true
MigrationPlan.releaseAllowed != false
```

An incompatible contract can still release only when an already-verified Migration Plan safely isolates the old execution path.

## Retire gate

Old deployment retirement requires:

```text
new release already applied
AND
explicit retirement approval
AND
old-version running executions = 0
AND
old-version suspended executions = 0
```

Status re-reads Runtime storage; it does not trust the stale counts stored at build time.

Critically, retirement checks only executions pinned to the previous Workflow version.

New v3 traffic cannot keep v2 alive forever.

## Deployment Adapter

Controller keeps the minimal `DeploymentAdapter` contract and supports an
optional phased `ExecutableDeploymentAdapter`:

```ts
publishPackage(...)
deploy(...)
checkHealth(...)
routeNewExecutions(...)
rollback(...)
retire(...)
```

The phased methods remain deployment-layer concerns; none are Runtime Core
primitives.

v0.49 includes:

```text
LocalReceiptDeploymentAdapter
```

It writes local release receipts instead of mutating real cloud infrastructure.

This is intentional for the MVP.

Future adapters can target:

```text
Kubernetes
Cloudflare
AWS
internal deployment platforms
GitHub Actions
```

without changing Builder/Controller policy.

## Verified lifecycle

The executable test performs:

```text
existing:
hr.leave.request@2

1 running
1 suspended

uair build
→ proposed v3

uair review
→ deployment ready

uair release
→ BLOCKED (no approval)

uair release --approve
→ release receipt created

uair status
→ retireReady=false

uair retire --approve
→ BLOCKED

old v2 executions drain

uair status
→ retireReady=true

uair retire --approve
→ v2 retirement receipt created

uair status
→ phase=retired
```

This is the first UAIR version where the previously designed analysis/planning chain is exposed as an end-user operational lifecycle.


## Crash/restart behavior

Release progress is checkpointed after each completed phase:

```text
publish
deploy
health
cutover
```

On restart:

```text
completed phase
→ skip

incomplete phase
→ invoke again using stable idempotency identity
```

Repeated `release --approve` after a completed release is also idempotent.

A failed candidate never becomes `state.released`. Rollback success/failure is
retained as release evidence for operators.
