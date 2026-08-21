# UAIR Deployment Planner — v0.61

Deployment Planner turns an approved Builder/Migration result into a phased rollout plan.

The key rule is:

```text
deploy != retire
```

A new version being healthy is not evidence that an old durable version is safe to delete.

## Phases

```text
DEPLOY
↓
CUTOVER
↓
RETAIN
↓
RETIRE
```

### Deploy

Publish the package and deploy the target Workflow version.

### Cutover

Route new executions to the target version.

Existing executions remain pinned to their persisted Workflow version.

### Retain

Keep the old Workflow/deployment available while any pinned execution is:

```text
running
suspended
```

### Retire

Retirement is guarded by an explicit `RetireGate`.

```ts
RetireGate {
  requiredActiveExecutions: 0
  currentActiveExecutions
  currentSuspendedExecutions
  ready
}
```

An old deployment can be retired only when:

```text
active == 0
AND
suspended == 0
```

## Example

Current production:

```text
hr.leave.request@2
deployment: deploy-leave-v2

1 running
1 suspended
```

Candidate:

```text
hr.leave.request@3
deployment: deploy-acme-leave-hr.leave.request-v3
```

Planner emits:

```text
DEPLOY
v3

CUTOVER
new executions → v3

RETAIN
v2 stays available

RETIRE
BLOCKED
```

RetireGate:

```text
active: 2
suspended: 1
ready: false
```

After old executions drain:

```text
active: 0
suspended: 0
ready: true
```

## Version-scoped deployment evidence

v0.48 records deployment usage by Workflow version:

```text
versionDeployments["2"]
  deploy-leave-v2 → 2
```

This prevents the planner from accidentally selecting a deployment belonging to a different historical version.

## Artifact

Deployment Planner emits:

```text
deployment/release-plan.json
```

containing:

```text
target package/version
target Workflow/deployment
previous version/deployment IDs
rollout steps
retire gate
```

It is release metadata, not automatic infrastructure mutation.

## Verification

`evaluateRetireGate()` can re-evaluate a DeploymentPlan against fresh Runtime Impact data.

This enables a future controller to do:

```text
deploy v3
↓
periodically re-read Runtime
↓
2 old executions
↓
1
↓
0
↓
retire gate opens
↓
authorized retirement
```

## Executable deployment adapters

v0.61 keeps planning separate from infrastructure, but the Release Controller
can now execute the verified plan through an adapter:

```text
publish package
→ deploy target
→ health verify
→ cut over new executions
→ retain old version
→ drain
→ retire
```

A failed health check or cutover triggers adapter rollback when supported.

The Controller persists release-phase checkpoints. If the Controller process
dies after a completed phase, the next approved release resumes from the last
durable checkpoint instead of blindly replaying every step.

Adapter operations MUST be idempotent by stable identity:

```text
packageName + packageVersion
deploymentId
workflowId + workflowVersion + deploymentId routing target
```

This covers the unavoidable crash window where an external platform operation
succeeds but the Controller dies before recording its checkpoint.

The reference `LocalReceiptDeploymentAdapter` records these operations locally.
Real adapters can target Kubernetes, Cloudflare, AWS or internal deployment
platforms without changing Runtime Core.
