# v0.36 Verification

> The historical sections below retain the version in which each gate was
> introduced. Current release gates also include the v0.68 durable semantics
> and PostgreSQL multiprocess checks.

## PostgreSQL multiprocess and SIGKILL verification — v0.68

The live gate starts independent Node.js processes against one PostgreSQL
database. Twelve contenders claim one routed job; exactly one process wins.
Another process claims a job and is terminated with `SIGKILL` before ACK. After
the visibility timeout, a scheduler reclaims and reassigns the job, and a fresh
process claims and ACKs the same durable job ID.

```text
contender processes             12
claim winners                    1
SIGKILL lease reclaimed          1
fresh process completed job   PASS
```

This verifies process isolation and database arbitration. It does not by itself
prove cross-machine network-partition behavior or universal exactly-once
external effects.

The productized monorepo was validated package-by-package.

Successful builds:

```text
@uair/core
@uair/ui
@uair/agent
@uair/mcp
@uair/package
@uair/security
@uair/sandbox
@uair/sqlite
@uair/oa
create-uair
```

Successful example builds:

```text
examples/basic
examples/enterprise
```

`create-uair` was executed in a fresh temporary directory:

```text
node packages/create-uair/dist/index.js demo-app
```

Generated:

```text
demo-app/
  package.json
  README.md
  src/index.ts
```

The generated source imports only the intended application-facing packages:

```text
@uair/core
@uair/ui
```

During productization an architectural dependency cycle was found and removed:

```text
@uair/package
↔ @uair/security
↔ @uair/sandbox
```

Dynamic acquisition execution was moved out of package metadata/discovery and into the sandbox layer.

This keeps the intended dependency direction substantially one-way.


## Browser playground verification

`@uair/core` and `examples/playground` compiled successfully.

A real Node server was started on port `8791` during verification.

API sequence:

```text
POST /api/start
task = Review expense report

result:
status = suspended
pending UI = ManagerApproval
```

Then:

```text
POST /api/ui/resolve
approved = true
comment = verified

result:
status = completed
```

Verified final result:

```json
{
  "task": "Review expense report",
  "proposal": {
    "search": {
      "matches": [
        "Result for Review expense report",
        "Policy document",
        "Expense report"
      ]
    },
    "summary": {
      "summary": "Summary prepared for Review expense report"
    }
  },
  "decision": {
    "approved": true,
    "comment": "verified"
  },
  "audit": {
    "auditId": "audit:Review expense report:approved"
  }
}
```

The verified execution contained 8 History entries.


## Execution Inspector verification

`@uair/core` and `examples/playground` compiled successfully.

A real server was started on port 8792.

Before manager approval:

```text
status = suspended

tree roots:
demo.permission      completed
agent:demo-agent     completed
ui:ManagerApproval   waiting

agent child count = 2
```

After resolving the UI:

```text
status = completed

tree roots:
demo.permission      completed
agent:demo-agent     completed
ui:ManagerApproval   resolved
demo.audit            completed
```

The nested Agent children were reconstructed from structural paths rather than a predefined visual graph.


## Debugger verification

Build:

```text
@uair/core             PASS
examples/playground    PASS
```

Manual resolve test:

```text
original execution = suspended
manual Suspension resolve
original execution = completed
```

Fork test:

```text
fork execution ID != original execution ID
fork status = suspended
original status remains completed
```

Retry / parallel projection test:

```text
demo.retryProbe
  completed
  failedAttempts = 1

demo.parallel.policy
  completed

demo.parallel.context
  completed
```

The Agent remains nested with two child Components, while ManagerApproval remains a waiting Suspension until resolved.


## Timing / Gantt verification

Build:

```text
@uair/core             PASS
examples/playground    PASS
```

Observed durable timings:

```text
demo.parallel.policy
  duration = 91 ms

demo.parallel.context
  duration = 45 ms

parallel overlap
  = 45 ms

agent:demo-agent
  duration = 94 ms

demo.search
  duration = 55 ms

demo.summarize
  duration = 36 ms
```

The retry probe recorded one failed attempt with:

```text
attemptStartedAt
failedAt
serialized Error
```

`ui:ManagerApproval` remained waiting with a durable start timestamp and no completion timestamp until resolution.

This verifies that the debugger can derive structural, temporal, retry and generation views from durable runtime history.


## Observability verification

Build:

```text
@uair/core       PASS
@uair/agent      PASS
@uair/mcp        PASS
@uair/otel       PASS
playground       PASS
```

Playground durable history verified:

```text
demo.search
attributes:
  demo.kind = search

metrics:
  demo.result_count = 3
```

and:

```text
demo.summarize
attributes:
  demo.kind = summarize
  demo.summary.mode = manager-ready
```

`executionToSpans()` was then verified with a synthetic Execution.

Observed span projection:

```text
demo.search
  uair.execution.id = exp_test
  uair.workflow = wf
  uair.path = 0
  uair.effect.id = exp_test:0:g0
  uair.generation = 0
  demo.kind = search
  demo.result_count = 3

ui:Approval
  uair.suspension.id = sus_1
  start = 200
  end = 500
```

The projection returned the expected two spans and preserved custom metrics/attributes.

Architectural result:

> UAIR stores execution semantics and observability metadata durably, while external tracing systems remain replaceable projections.


## Workflow/versioning verification

Build:

```text
@uair/core          PASS
@uair/sqlite        PASS
@uair/agent         PASS
@uair/mcp           PASS
@uair/otel          PASS
examples/versioning PASS
playground          PASS
```

Real versioning scenario:

```text
UAIR v0.24 versioning verification: PASS
```

Verified guarantees:

1. A new Execution pins `workflowVersion`.
2. A new Execution pins `historySchemaVersion = 3`.
3. An execution started on workflow v1 resumes with v1 after v2 is deployed when both are registered.
4. A newly started v2 execution pins version 2.
5. Directly attempting to resume a v1 execution with v2 throws `WorkflowVersionMismatchError`.
6. Legacy records without version metadata migrate through schema 1 → 2 → 3.
7. If v1 code is no longer registered, a v1 execution does not silently use v2.
8. An explicitly registered v1 → v2 WorkflowUpgrade can migrate the execution.
9. That upgrade writes a durable `workflow_upgraded` History entry.
10. SQLite persists and reloads workflow/history schema versions.

SQLite round trip:

```text
workflowVersion = 7
historySchemaVersion = 3
```

Architectural result:

> Workflow code is part of durable execution identity. Deployment is therefore version routing plus explicit migration, not implicit replay through whatever code happens to be latest.


## Deployment identity verification

Build:

```text
@uair/core          PASS
@uair/sqlite        PASS
examples/versioning PASS
playground          PASS
```

Real versioning/deployment run:

```text
UAIR v0.25 deployment identity verification: PASS
```

Verified properties:

1. Deployment manifests can be generated from registered Workflows.
2. A manifest validates matching deployed Workflow code.
3. Registering two different handlers under the same workflow name/version throws `WorkflowFingerprintMismatchError`.
4. New Executions persist an exact workflow fingerprint.
5. Resuming an Execution against changed code under the same version throws `ExecutionDeploymentMismatchError`.
6. Explicit workflow upgrades move version, fingerprint and deployment identity together.
7. Legacy executions can adopt a fingerprint durably on first compatible resume.
8. Current History schema is version 4.
9. SQLite persists workflow version, deployment ID, workflow fingerprint and History schema version.

SQLite round trip:

```text
workflowVersion = 5
deploymentId = deploy-A
historySchemaVersion = 4
workflowFingerprint = 83301e6a...
```

Architectural result:

> Durable Workflow identity is no longer a human-written version string alone; it is a compatibility version plus exact code fingerprint plus deployment provenance.


## Worker routing verification

Build and runtime verification:

```text
@uair/core        PASS
examples/routing PASS
```

Observed final marker:

```text
UAIR v0.26 worker routing verification: PASS
```

Verified guarantees:

1. Execution routing identity includes workflow name/version/deployment/fingerprint.
2. A v1 Execution routes to the worker registered for the exact v1 identity.
3. A v2 Execution routes to the worker registered for the exact v2 identity.
4. Exact fingerprint matching is required when the Execution is fingerprint-pinned.
5. Exact deployment matching is required when the Execution is deployment-pinned.
6. Wrong-code workers are rejected as incompatible.
7. Routed jobs include the durable route identity and selected worker ID.
8. `RoutedWorker` reloads and revalidates durable identity before handling.
9. A routed v1 job can be handled by a worker whose local registry contains only v1.
10. Workers no longer need to load every historical Workflow version in one process.

Architectural result:

> Durable Workflow identity now participates in scheduling, not only resume validation. Old executions can be routed to old deployment pools while new executions use new pools.


## Worker lifecycle verification

Build/runtime:

```text
@uair/core        PASS
examples/routing PASS
```

Observed final marker:

```text
UAIR v0.27 worker lifecycle verification: PASS
```

Verified properties:

1. Worker lifecycle supports `active`, `draining`, and `offline`.
2. Draining workers remain eligible for compatible resume work.
3. Draining workers are excluded from new-execution admission.
4. Heartbeat leases remove expired workers from scheduling eligibility.
5. `heartbeat()` refreshes liveness and current load/capacity information.
6. Capacity is enforced as a hard `queueDepth + activeJobs < capacity` boundary.
7. Multiple exact-compatible workers are ranked by normalized load.
8. Deterministic worker ID ordering is used only as a tie-breaker.
9. `canShutdown()` remains false while a draining worker has queued or active jobs.
10. `canShutdown()` becomes true after both counts reach zero.
11. RoutedWorker supports queue/active accounting around execution handling.
12. DeploymentRouter exposes explicit new-execution selection separate from resume routing.

Architectural result:

> Rolling deployment is now an execution-routing policy: old workers stop accepting new obligations while remaining available for old pinned executions until their durable workload drains to zero.


## Reliable queue verification

Full affected build regression:

```text
@uair/core          PASS
@uair/sqlite        PASS
@uair/ui            PASS
@uair/agent         PASS
@uair/mcp           PASS
@uair/package       PASS
@uair/security      PASS
@uair/sandbox       PASS
@uair/otel          PASS
@uair/oa            PASS
examples/routing    PASS
examples/versioning PASS
examples/playground PASS
examples/reliable-queue PASS
```

Observed marker:

```text
UAIR v0.28 reliable queue verification: PASS
```

Verified queue semantics:

1. Routed jobs remain queued until explicitly claimed.
2. Claim creates a visibility lease with a unique lease token.
3. Claim moves scheduler load from queueDepth to activeJobs.
4. Worker crash before ACK leaves the job recoverable.
5. Visibility timeout reclaims the leased job.
6. Reclaimed jobs are routed again using current worker health/capacity/identity.
7. A job originally claimed by worker A was rerouted to worker B after A heartbeat expiry.
8. Successful ACK permanently removes the job.
9. NACK schedules redelivery with backoff.
10. Attempt exhaustion moves the job to dead-letter state instead of dropping it.
11. Stale/invalid leases are rejected.
12. `reclaimWorker()` can immediately reclaim known-dead worker leases.
13. Jobs with temporarily no compatible worker remain durable and can later be assigned by `routePending()`.

SQLite crash/restart scenario:

```text
dispatch
→ durable SQLite row
→ worker claims
→ leased SQLite row
→ queue instance closes
→ worker marked offline
→ fresh queue instance opens same DB
→ reconcileDirectoryLoad()
→ reclaimExpired()
→ reroute to surviving worker
→ claim
→ ACK
→ SQLite queue empty
```

This verifies that dispatch success followed by worker and scheduler failure does not lose the resume job.

Architectural result:

> Routing chooses the compatible execution environment; the reliable queue owns
> delivery until ACK. Worker execution is therefore at-least-once at the
> job-delivery layer. Completed Component History prevents replay of an already
> recorded effect. A crash after an external side effect but before History is
> durable can still retry the handler, so the external operation must
> deduplicate by `ctx.effectId` or be independently idempotent.


## JobQueue / leaderless scheduler verification

Full TypeScript regression:

```text
packages/agent           PASS
packages/core            PASS
packages/create-uair     PASS
packages/mcp             PASS
packages/oa              PASS
packages/otel            PASS
packages/package         PASS
packages/postgres        PASS
packages/sandbox         PASS
packages/security        PASS
packages/sqlite          PASS
packages/ui              PASS
examples/basic           PASS
examples/enterprise      PASS
examples/job-queue-spi   PASS
examples/playground      PASS
examples/reliable-queue  PASS
examples/routing         PASS
examples/versioning      PASS
```

Real SQLite two-process claim contention:

```text
SQLite concurrent claim winners: 1
```

Real SQLite two-process leaderless lease maintenance:

```text
scheduler A reclaimed + scheduler B reclaimed = 1
```

PostgreSQL reference claim contract verified to contain:

```text
FOR UPDATE SKIP LOCKED
UPDATE uair_routed_jobs
RETURNING jobs.*
```

Final marker:

```text
UAIR v0.29 JobQueue SPI verification: PASS
```

PostgreSQL live-server contention is intentionally not reported as tested because no PostgreSQL runtime is available in the current execution environment.

Architectural result:

> Scheduler availability no longer depends on electing a UAIR leader. The queue backend owns atomic claims/lease transitions; schedulers are horizontally replicable maintenance/routing processes.


## Shared worker registry verification

Full TypeScript regression:

```text
all packages   PASS
all examples   PASS
```

Shared SQLite registry example:

```text
UAIR v0.30 shared worker registry verification: PASS
```

Verified behavior:

1. Two independent SQLite registry instances see the same worker records.
2. Shared capacity/queueDepth/activeJobs affect load-aware routing identically.
3. A lifecycle update written through one registry instance is visible through another.
4. `draining` remains eligible for `resume` but is excluded for `new` execution admission.
5. Heartbeat lease expiry removes a worker from every scheduler's compatible set.
6. A later heartbeat restores worker eligibility and updates shared load.
7. `SharedRegistryQueueScheduler` refreshes its local WorkerDirectory snapshot from shared state before routing pending jobs.
8. A pending job routes using the shared worker state rather than stale scheduler-local registration.
9. PostgreSQL shared registry schema contains durable heartbeat/load/lifecycle fields.
10. PostgreSQL worker registration uses atomic `ON CONFLICT(worker_id) DO UPDATE` UPSERT semantics.

Cross-process SQLite verification:

```text
Process A registers:
  cross-worker
  queueDepth = 2
  activeJobs = 1

Process B opens the same database:
  reads the worker successfully
  sets lifecycle = draining
  updates queueDepth = 0
  updates activeJobs = 0
```

The final persisted record observed by Process B contained the expected shared state.

Architectural result:

> Job state and worker-cluster state are now both shared durable coordination planes. Scheduler instances can remain leaderless and disposable.


## Atomic capacity reservation verification

Full TypeScript build:

```text
all packages PASS
all examples PASS
```

Single-host dual-scheduler test:

```text
capacity = 1
two pending jobs
two AtomicCapacityQueueScheduler instances

sum(routed) = 1
assigned = 1
pending = 1
shared queueDepth = 1
```

After heartbeat resets queue depth:

```text
next tick routed = 1
```

Independent-process SQLite reservation race:

```text
Process A: worker-one
Process B: NONE
winners: 1
queueDepth: 1
```

PostgreSQL reservation contract verified to contain:

```text
FOR UPDATE SKIP LOCKED
queue_depth + active_jobs < capacity
SET queue_depth = queue_depth + 1
RETURNING worker_id
```

Observed final marker:

```text
UAIR v0.31 atomic capacity reservation verification: PASS
```

Architectural result:

> leaderless schedulers can now share both worker discovery and capacity admission without overbooking the same final worker slot.


## Cluster chaos verification

Default deterministic run:

```text
UAIR v0.33 chaos harness verification: PASS
```

Observed:

```text
seed                    195936478
executions              16
completed               16
external side effects   16
transient retry failures 6
crash after handle      3
lease reclaim/redelivery 3
max load ratio          1
DLQ                     0
```

A 12-seed soak was also executed with 6 executions per workflow version per seed:

```text
seeds                    12
total executions         144
total crash-after-handle 36
total reclaimed leases   36
max load ratio           1
total DLQ                0
```

Every seed separately asserted:

1. Every durable Execution eventually reached `completed`.
2. Every queue job eventually ACKed and disappeared.
3. Every approved business execution invoked the intentionally non-idempotent external side-effect handler exactly once.
4. Component transient failures appeared as the expected durable retry history entries.
5. Crash-after-handle-before-ACK occurred and forced visibility-timeout redelivery.
6. Redelivery did not repeat already completed side effects.
7. Shared worker capacity was never oversold.
8. Rolling-deploy `draining` state remained compatible with old resume work.
9. Offline worker instances could return after the lease window and restore liveness.

An initial run intentionally exposed a liveness condition: if every compatible worker for a pinned deployment remains offline forever, the corresponding Execution remains durably suspended/queued rather than being lost or routed to incompatible code. The harness now models instance restart after failure so eventual-completion invariants have a valid liveness assumption.


## v1-alpha hardening verification

- Core root application API separated from runtime/cluster/internal subpaths.
- All internal packages/examples migrated to explicit subpath imports.
- `npm run check:api` guards the root runtime export list and forbids reviewed implementation symbols from leaking into `@uair/core`.
- Full TypeScript project build remains required after the split.
- Chaos Harness remains a release gate; no runtime semantics were weakened by the API cleanup.


## Packaging / release smoke

```text
create-uair generated dependency @uair/core = ^0.33.0   PASS
11 publishable packages npm pack --dry-run              PASS
API surface guard                                       PASS
full TypeScript build                                   PASS
default Chaos Harness                                   PASS
```

Default post-hardening Chaos run:

```text
executions = 16
completed = 16
sideEffects = 16
crashAfterHandleCount = 5
reclaimedCount = 5
maxObservedLoadRatio = 1
deadLetters = 0
```


## v0.34 real PostgreSQL gate hardening

v0.34 added:

```text
examples/postgres-integration/index.mjs
examples/postgres-integration/README.md
.github/workflows/postgres-integration.yml
scripts/check-postgres-gate.mjs
```

The real PostgreSQL harness is designed to run against multiple independent connections and asserts:

```text
single queued job + 12 concurrent claimers
→ exactly one claim winner

single expired lease + 8 concurrent reclaimers
→ reclaim transition count exactly one

worker registry written through connection A
→ visible and mutable through connection B

capacity=1 + 12 concurrent reservations
→ exactly one reservation winner
→ shared queueDepth = 1

2 AtomicCapacityQueueSchedulers
+ 2 unassigned jobs
+ 1 shared worker capacity slot
→ total routed = 1
→ assigned jobs = 1
→ unassigned jobs = 1
→ shared queueDepth = 1
```

GitHub Actions provisions:

```text
postgres:16
database = uair_test
Node.js = 22
```

and builds only:

```text
@uair/core
@uair/postgres
```

before running the integration harness.

### Local execution result

The v0.34 artifact environment had no:

```text
postgres
psql
docker
podman
pg Node module
```

Therefore **the real PostgreSQL database harness was not executed locally**.

Local checks that did execute:

```text
npx tsc -b --pretty false
PASS

npm run check:api
UAIR v1-alpha API surface check: PASS

npm run check:postgres-gate
UAIR v0.34 PostgreSQL gate contract check: PASS

npm run chaos
executions = 16
completed = 16
sideEffects = 16
retryFailures = 6
crashAfterHandleCount = 5
reclaimedCount = 5
maxObservedLoadRatio = 1
deadLetters = 0
UAIR v0.34 chaos harness verification: PASS
```

All 12 publishable packages also passed:

```text
npm pack --dry-run
```

The PostgreSQL row in the v1-alpha test matrix remains an open release gate until the real CI service job is observed green.

Architectural result:

> v0.34 does not claim new PostgreSQL semantics; it converts the existing PostgreSQL concurrency semantics into a real-database executable gate and makes that gate mandatory for v1-alpha evidence.


## v0.36 release-polish verification

Developer experience / publish hardening:

```text
workflow({ id, run }) preferred object API          PASS
component({ id, run }) preferred object API         PASS
Workflow/Component `.id` aliases                     PASS
RuntimeEngine(storage, [workflow])                   PASS
asAgentTool(component) identity derivation           PASS
Agent `parseArgs` runtime validation                  PASS
DX duplicate-magic-value gate                        PASS
```

Fault/replay regression after API cleanup:

```text
Chaos executions                16
completed                       16
sideEffects                     16
retryFailures                    6
ACK-before-crash recoveries      2
reclaimed                        2
maxObservedLoadRatio             1
deadLetters                      0
```

Real process fault regression:

```text
SIGKILL                         1
lease reclaimed                 1
redelivered                     1
externalSideEffects             1
deadLetters                     0
```

Packaging:

```text
12 publishable packages
npm pack --dry-run              PASS
```

The real PostgreSQL integration workflow remains authored but not observed green in this local environment. Namespace ownership and license selection remain explicit human release decisions.
