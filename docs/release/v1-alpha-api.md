# UAIR v1-alpha API Contract

The v1-alpha goal is not to freeze every currently implemented interface. It is to freeze the smallest set application authors need, while keeping runtime adapters and cluster machinery evolvable.

## Tier 1 — application API: candidate for v1 compatibility

Import from `@uair/core`:

```ts
workflow()
component()
parallel()
race()
run()
resume()
RuntimeEngine
```

Primary application types:

```text
WorkflowDefinition
WorkflowOptions
Component
ComponentContext
ComponentOptions
RetryPolicy
SuspendOptions
Execution
ExecutionStatus
PreviousResult
```

Application packages should normally import only this entry point plus ecosystem packages such as `@uair/ui`, `@uair/agent`, and `@uair/mcp`.

## Tier 2 — runtime adapter API: alpha, not yet compatibility-frozen

Import from `@uair/core/runtime`.

This layer contains storage, durable-event, versioning, migration, deployment identity, and manual suspension APIs needed by storage adapters, servers, debuggers, and deployment tooling.

Examples:

```text
Storage
JsonFileStorage
resolveSuspension
ExternalEvent
VersionedWorkflowRegistry
HistoryMigration
createDeploymentManifest
fingerprintWorkflow
```

These concepts are necessary, but exact interfaces may still change before v1 stable.

## Tier 3 — cluster API: experimental in v1-alpha

Import from `@uair/core/cluster`.

```text
WorkerDirectory
DeploymentRouter
JobQueue
ReliableWorkerConsumer
AtomicCapacityQueueScheduler
SharedWorkerRegistry
WorkerHeartbeatPublisher
```

Cluster scheduling is deliberately separated from the application API. A user should be able to build a local durable application without learning any of these concepts.

## Tier 4 — adapter implementation SPI: alpha

Import from `@uair/core/adapter` only when implementing a UAIR storage or
locking adapter.

```text
currentFence
runWithFence
StaleFenceError
LockManager
```

Application code must not depend on this layer.

## Tier 5 — internal API: no compatibility promise

`@uair/core/internal` remains as a v0.x compatibility path for existing
adapters. New adapters must use `@uair/core/adapter`; application code must not
depend on either path.

```text
currentFence
runWithFence
StaleFenceError
InMemoryLockManager
InMemoryResumeQueue
```

Application code must not depend on this layer.

## Deliberately not frozen

The following remain provisional:

```text
raw History record schema
SQLite/PostgreSQL physical schemas
worker registry row shape
queue record shape
scheduler selection algorithm
sandbox manifest exact schema
Capability ranking algorithm
Agent turn-state representation
OpenTelemetry attribute naming beyond uair.* identity fields
```

## Compatibility policy

A v1-compatible application should be expressible primarily with:

```text
Workflow
Component
Suspension through an adapter such as UI
```

New ecosystem features should map onto those primitives instead of adding kernel node types.


## UI authoring surface

Preferred `@uair/ui` API:

```text
surface()
input()
choose()
present()
```

The older `ui()` and `displayUi()` exports remain v0.x compatibility aliases and
are deprecated for new application code.

Blocking semantics:

```text
surface / input / choose
→ durable Suspension
```

Non-blocking semantics:

```text
present
→ display only
```

## Authoring metadata rule

Ordinary Workflow authors should normally set only:

```text
stable id
optional version when evolving durable code
```

`deploymentId` and `fingerprint` are advanced host/tooling metadata and should
not become routine application configuration.
