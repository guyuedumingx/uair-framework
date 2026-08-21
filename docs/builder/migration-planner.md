# UAIR Migration Planner — v0.47

Migration Planner answers the question that follows a failed compatibility check:

> The candidate is incompatible. What is the safest way to release it?

It does not mutate Runtime History automatically.

## Strategy order

The conservative default order is:

```text
1. version-isolation
2. compatibility-adapter
3. explicit workflow-upgrade
```

Direct durable payload mutation is not a default strategy.

## Version isolation

For an existing Workflow:

```text
hr.leave.request@2
```

with active executions and a candidate:

```text
hr.leave.request@3
```

Migration Planner can select:

```text
version-isolation
```

Actions:

```text
keep hr.leave.request@2 registered
keep the old deployment recoverable
route new executions to @3
let old executions drain on @2
do not rewrite persisted History
```

This uses the existing `VersionedWorkflowRegistry` semantics in Runtime Core.

Verified routing:

```text
old execution pinned to v2
→ resolves to v2

new execution pinned to v3
→ resolves to v3
```

## Why this can remediate a contract break

Suppose v3 has a new Surface contract that cannot consume a payload already suspended under v2.

The candidate v3 is incompatible with the old durable payload.

That does not necessarily mean v3 cannot be released.

If:

```text
v2 remains registered/routable
AND
old execution remains pinned to v2
AND
new executions start on v3
```

then the old payload never crosses the new contract boundary.

Migration Planner can therefore mark the release as allowed under version isolation while still preserving the incompatibility evidence in the Release Proposal.

## Generated migration artifact

Planner emits:

```text
migration/version-isolation.json
```

Example:

```json
{
  "strategy": "version-isolation",
  "workflow": "hr.leave.request",
  "currentVersion": "2",
  "targetVersion": "3",
  "activeExecutions": 2,
  "suspendedExecutions": 1,
  "preserveOldDeployment": true,
  "routeNewExecutionsTo": "3"
}
```

This is deployment/release metadata, not a mutation of Runtime state.

## Compatibility adapter

Planner exposes a compatibility-adapter option but does not mark it safe automatically when required values are missing.

Example:

```text
old payload:
employeeId
days

new payload:
employeeId
days
departmentId required
```

Builder cannot invent `departmentId`.

A safe adapter requires an explicit mapping/default policy plus tests against historical payload samples.

## Workflow upgrade

UAIR already supports explicit durable upgrades:

```ts
registry.registerUpgrade({
  workflow:
    "hr.leave.request",
  fromVersion:
    "2",
  toVersion:
    "3",

  migrate(execution) {
    return migrated;
  }
});
```

Migration Planner only considers this safe when:

```text
contract is compatible
no unresolved Suspension blocks conversion
target Workflow version exists
migration is deterministic and tested
```

v0.47 does not synthesize arbitrary `WorkflowUpgrade` code automatically.

## Release gate

Builder flow is now:

```text
ChangeSet
↓
Change Safety
↓
Contract Compatibility
↓
Runtime Impact
↓
Migration Planner
↓
Migration Verification
↓
Release Proposal
```

An incompatible candidate can proceed only if the selected Migration Plan:

```text
releaseAllowed = true
verification.passed = true
```

A same-version change still cannot be rescued by Migration Planner because ChangeSet safety fails earlier.

## Current limitations

v0.47 deliberately does not automatically:

```text
rewrite persisted History
invent missing business values
delete old deployments
run database migrations
synthesize arbitrary WorkflowUpgrade functions
```

Those require stronger explicit policies and evidence.
