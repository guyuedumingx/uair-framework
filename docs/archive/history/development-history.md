# UAIR Framework v0.36 — v1-alpha candidate

Universal AI Runtime is a TypeScript framework for durable AI-native applications: ordinary code, bounded Agents, human UI suspensions, crash-safe replay, and version-aware distributed execution.

This version reorganizes the validated v0.17 PoC into publishable npm package boundaries without changing the core execution model.

## 60-second mental model

Application developers primarily need:

```ts
workflow()
component()
```

Everything else maps onto those primitives:

```text
MCP Tool      -> Component
LLM call      -> Component
Agent         -> Component containing Components
Blocking UI   -> Component + Suspension
Business flow -> Workflow
```


## Stable identity without magic-value duplication

Durable workflows need explicit stable IDs; deriving them from variable names, filenames, or `Function.name` would break across refactors and bundling.

The v1 rule is:

```text
explicit once
referenced by object thereafter
```

Preferred:

```ts
export const approval =
  workflow({
    id: "order.approval",
    version: "1",

    async run(input) {
      // normal TypeScript
    }
  });

const engine =
  new RuntimeEngine(
    storage,
    [
      approval
    ]
  );
```

Components also expose `.id`, and Agent tools can derive their default model-facing name directly:

```ts
const search =
  component({
    id: "search",

    async run(input) {
      ...
    }
  });

const tool =
  asAgentTool(search);

return {
  type: "tool",
  tool: search.id,
  args: ...
};
```

See `../../concepts/durable-identity.md`.

## Packages

```text
@uair/core
  durable Workflow / Component runtime

@uair/sqlite
  SQLite persistence + multi-process lease/fencing

@uair/postgres
  PostgreSQL reliable queue + shared worker registry

@uair/mcp
  MCP client adapter

@uair/ui
  blocking/non-blocking UI primitives

@uair/agent
  Agent + LLM package layer

@uair/package
  CapabilitySet, package contract, discovery, resolver

@uair/security
  RBAC + package trust policy

@uair/sandbox
  sandboxed acquisition and sandbox-proxy capabilities

@uair/otel
  OpenTelemetry-style durable execution projection

@uair/oa
  example domain package showing reusable OA composition

create-uair
  minimal application scaffolder
```


## Positioning

UAIR is intentionally not an "everything is a plugin" Agent harness.

Its core positioning is:

```text
build durable software where Agents are one controlled execution primitive
```

A detailed comparison with the current DeepSeek Harness architecture is in:

```text
../../comparisons/deepseek-harness.md
```

## Dependency direction

The intended dependency graph is one-way:

```text
@uair/core
   ↑
ui / agent / mcp / sqlite
   ↑
@uair/package
   ↑
@uair/security
   ↑
@uair/sandbox / domain packages
```

Runtime Core must not depend on Agent, MCP, OA, RBAC, npm, or sandbox concepts.

## v1 public API candidate

The following surface is the current freeze candidate.

### @uair/core

```ts
workflow()
component()
parallel()
race()
run()
resume()

RuntimeEngine

resolveSuspension()
cancelSuspension()
```

Primary public types:

```ts
WorkflowDefinition
Component
ComponentContext
ComponentOptions
RetryPolicy
SuspendOptions
Execution
Storage
ExternalEvent
```

### @uair/ui

```ts
ui()
displayUi()
listPendingUi()
uiResultEvent()
```

### @uair/agent

```ts
agent()
asAgentTool()
llm()
jsonAgentModel()
```

### @uair/mcp

```ts
mcp()
connectMcpHttp()
connectMcpStdio()
```

### @uair/package

```ts
CapabilitySet
capability()
CapabilityResolver
PackageDiscovery
UairApplication

loadUairPackage()
loadInstalledUairPackage()
```

### @uair/security

```ts
createRbac()
staticTrustPolicy()
```

### @uair/sandbox

```ts
SandboxedPackageInstaller
createSandboxPackageAcquirer()
activateSandboxPackage()
sandboxedCapability()
```

## APIs not frozen yet

These should be treated as implementation/advanced surfaces until more production testing:

```text
HistoryEntry exact schema
fencing internals
SQLite schema
outbox/inbox record shape
lease timing defaults
sandbox manifest format
package trust-record fields
Capability ranking algorithm
Agent turn-state schema
```

The important policy is:

> stabilize concepts first; stabilize storage/event schemas only after migration/versioning exists.

## Create an app

Once packages are published:

```bash
npm create uair@latest my-app
cd my-app
npm install
npm run dev
```

Current local source equivalent:

```bash
node packages/create-uair/dist/index.js my-app
```

The generated code begins with:

```ts
import {
  workflow
} from "@uair/core";

import {
  ui
} from "@uair/ui";

const ask =
  ui<
    { prompt: string },
    { answer: string }
  >("Question");

export const app =
  workflow(
    "app",
    async () => {
      return ask({
        prompt:
          "Hello from UAIR"
      });
    }
  );
```

## Enterprise composition

```ts
import {
  createRbac
} from "@uair/security";

import {
  createOaPackage
} from "@uair/oa";

const rbac =
  createRbac(policy);

const oa =
  createOaPackage({
    requirePermission:
      rbac.requirePermission
  });
```

The package remains normal npm composition; there is no UAIR package manager.

## Repository status

v0.18 is a productization draft, not a production release.

Validated in this build:

```text
all publishable package boundaries compile
basic example compiles
enterprise example compiles
create-uair CLI generates a project
```

The semantic runtime verification remains inherited from v0.17, where the full durable end-to-end suite passed.

Next productization work should focus on:

```text
public API docs
migration/versioning for durable histories
real package publishing dry-run
real sandbox backend
HTTP/WebSocket UI transport package
one polished end-to-end example app
```


## Browser Playground — v0.19

A real browser-facing demo now lives at:

```text
examples/playground
```

Build and run:

```bash
npx tsc -p examples/playground/tsconfig.json
cd examples/playground
npm start
```

Then open:

```text
http://localhost:8787
```

The page shows:

```text
task composer

execution timeline
  permission
  agent
    search
    summarize
  manager approval
  audit

current blocking UI / final result

raw durable History
```

### Verified transition

The playground was started against the real UAIR runtime and exercised through its HTTP API.

Observed:

```text
POST /api/start
→ status = suspended
→ PendingUi = ManagerApproval

POST /api/ui/resolve
→ status = completed
```

Final result contained:

```text
Agent search result
Agent summary
manager approval decision
mandatory audit result
```

History contained 8 durable entries in the verified run.

### Why this demo matters

The browser is not executing a separate graph runtime.

It is only a renderer/adapter over:

```text
Execution
History
PendingUi
ExternalEvent
```

The actual control flow remains ordinary TypeScript Workflow code.

This allows the visual experience to evolve independently of the durable kernel.


## Execution Inspector — v0.20

The browser playground now projects durable History into a clickable execution tree.

Observed suspended tree:

```text
demo.permission ✓
agent:demo-agent ✓
  demo.search ✓
  demo.summarize ✓
ui:ManagerApproval ⏸
```

After UI resolution:

```text
demo.permission ✓
agent:demo-agent ✓
  demo.search ✓
  demo.summarize ✓
ui:ManagerApproval resolved
demo.audit ✓
```

The tree is reconstructed from structural effect paths stored in History. It is not authored as a separate graph definition.

Clicking a node shows:

```text
status
path
generation
effectId
suspensionId
attempt count
duration
output
retry failures
```

This demonstrates the intended developer experience:

> write ordinary TypeScript control flow; get an execution graph automatically from durable runtime history.


## Execution Debugger — v0.21

The Playground inspector now supports active debugging rather than read-only tracing.

New capabilities:

```text
generation history
retry attempt visibility
replay markers
structured parallel branch visibility
manual Suspension resolve
Execution fork
```

### Retry visualization

The demo contains a deterministic transient Component:

```text
demo.retryProbe
```

Attempt 1 fails and attempt 2 succeeds.

The Inspector projects:

```text
demo.retryProbe ✓
  generation g0
  failed attempts: 1
  final status: completed
```

The raw attempt error remains available in node detail.

### Structured parallel visualization

The demo now executes:

```text
demo.parallel.policy
demo.parallel.context
```

through `parallel()`.

Both branches appear as independently managed durable effects in the Inspector.

### Replay / generation

Nodes now expose all observed generations rather than only the latest one:

```text
g0
g1
g2
...
```

If a path advances to a later generation due to expiry/revalidation, the UI marks the node as replayed and exposes every generation record.

### Manual Suspension resolve

A waiting Suspension can be selected and manually resolved from the Inspector.

The debugger accepts a JSON result and routes it through the real runtime:

```text
resolveSuspension
→ durable resume intent
→ recovery
→ replay
```

This is intended for development/debugging, not as a production authorization bypass.

### Execution fork

Any current execution can be forked.

Fork semantics:

```text
original Execution remains immutable
new Execution gets a new ID
new Execution starts from original Workflow input
History is not copied
```

This makes it possible to reproduce a scenario while preserving the original durable audit trail.

### Verified debugger behavior

A real playground server verified:

```text
original execution:
  suspended

manual resolve:
  original becomes completed

fork:
  new execution ID
  new execution becomes suspended independently

original:
  remains completed and unchanged
```

Retry + parallel verification additionally observed:

```text
demo.permission          completed
demo.retryProbe          completed / 1 failed attempt
demo.parallel.policy     completed
demo.parallel.context    completed
agent:demo-agent         completed
  demo.search            completed
  demo.summarize         completed
ui:ManagerApproval       waiting
```


## Time-aware Execution Debugger — v0.22

v0.22 adds durable timing data and a Gantt-style execution timeline.

### Durable timing fields

Effect history now records:

```text
startedAt
completedAt
input
output
```

Retry failures record:

```text
attemptStartedAt
failedAt
input
error
```

Suspensions record:

```text
createdAt
input
resolvedAt
output
```

The new fields are optional in the type definitions so older persisted histories remain readable.

### Timeline / Gantt

The Playground renders every timed node onto one shared execution scale.

This makes parallel overlap visible instead of inferred from tree shape.

Verified example:

```text
demo.parallel.policy
  duration = 91 ms

demo.parallel.context
  duration = 45 ms

measured overlap = 45 ms
```

The two effects began approximately together and actually overlapped.

The same timeline also exposes:

```text
Agent total latency
nested tool latency
UI waiting time
retry attempts
slowest effects
```

A waiting Suspension extends to "now" in the live browser timeline.

### Historical generation inspection

Node detail now allows selecting:

```text
g0
g1
g2
...
```

Each generation shows its own:

```text
input
output
effectId
status
started/completed timestamps
duration
retry attempts
```

This is important for stale-result refresh and authorization renewal debugging, where a single structural path can have multiple historical generations.

### Retry timing

The deterministic playground retry produces:

```text
demo.retryProbe
  attempt 1 failed
  attempt 2 completed
```

The failed attempt includes its own start/end timing and serialized error.

### Debugging model

The intended debugger model is now:

```text
Tree
= causal/structural view

Timeline
= temporal view

Generation selector
= historical view

Raw History
= durable truth
```

All four views are projections over one execution record.


## Observability / OpenTelemetry bridge — v0.23

v0.23 adds a first-class observability boundary without putting OpenTelemetry into Runtime Core.

### Durable attributes and metrics

Components can now emit durable metadata:

```ts
component(
  "search",
  {
    attributes: {
      "service.kind":
        "search"
    }
  },
  async (input, ctx) => {
    ctx.setAttribute(
      "search.index",
      "documents"
    );

    ctx.addMetric(
      "search.result_count",
      12
    );

    ...
  }
);
```

The values are persisted in History next to the effect/suspension record.

This means the same data is available to:

```text
UAIR Debugger
OTel exporter
audit tooling
cost dashboards
offline analysis
```

without requiring the provider to be online at execution time.

### Adapter-level instrumentation

The MCP adapter now attaches:

```text
rpc.system = mcp
mcp.server
mcp.tool
mcp.latency_ms
```

The LLM adapter attaches:

```text
ai.system
ai.operation = completion
ai.latency_ms
```

Provider-specific adapters can add:

```text
ai.input_tokens
ai.output_tokens
ai.cost_usd
http.status_code
db.rows
cache.hit
```

using the same generic Component context API.

### @uair/otel

A new package:

```text
@uair/otel
```

projects Execution History into span-like records:

```text
Execution
  ↓
effect/suspension History
  ↓
executionToSpans()
  ↓
SpanLike[]
  ↓
SpanExporter
```

Standard attributes include:

```text
uair.execution.id
uair.workflow
uair.path
uair.effect.id
uair.generation
uair.suspension.id
uair.attempt
```

The runtime kernel remains independent of any concrete OpenTelemetry SDK.

### Debugger integration

Node detail now shows:

```text
input
output
attributes
metrics
retry attempts
timing
generation
```

So observability data is visible locally even when no external telemetry backend exists.

### Verified OTel projection

A synthetic durable Execution was projected into spans and verified:

```text
demo.search
  startTime = 100
  endTime = 160
  status = ok
  demo.kind = search
  demo.result_count = 3

ui:Approval
  startTime = 200
  endTime = 500
  uair.suspension.id = sus_1
```

The projection passed all checks.


## Workflow / History Versioning — v0.24

v0.24 closes the deployment-version gap for long-lived durable executions.

### Workflow version pinning

A Workflow may now declare:

```ts
const approval =
  workflow(
    "approval",
    {
      version: "2"
    },
    async input => {
      ...
    }
  );
```

Every newly created Execution persists:

```text
workflow = approval
workflowVersion = 2
historySchemaVersion = 3
```

An Execution never silently switches to newer Workflow code on resume.

### Backward compatibility

Existing code remains valid:

```ts
workflow(
  "approval",
  async input => {
    ...
  }
);
```

which is interpreted as:

```text
version = "1"
```

Old persisted Execution records without `workflowVersion` are likewise interpreted as version `"1"`.

### Direct wrong-version resume

If code attempts:

```text
Execution pinned to v1
+
resume(v2)
```

UAIR throws:

```text
WorkflowVersionMismatchError
```

instead of replaying against incompatible code.

### VersionedWorkflowRegistry

RuntimeEngine can now receive:

```ts
new VersionedWorkflowRegistry([
  approvalV1,
  approvalV2
]);
```

When an old Execution resumes after a deployment:

```text
Execution says version 1
↓
registry resolves approval@1
↓
resume with v1 code
```

while newly started executions can use v2.

### Explicit workflow upgrades

Keeping every historical code version forever is not required.

A deployment may explicitly register:

```ts
registry.registerUpgrade({
  workflow: "approval",
  fromVersion: "1",
  toVersion: "2",

  migrate(execution) {
    return transformedExecution;
  }
});
```

Only then may a v1 Execution move to v2.

The upgrade appends a durable audit entry:

```text
workflow_upgraded
  workflow
  fromVersion
  toVersion
  upgradedAt
```

There is no automatic compatibility guessing.

### History schema migration

Execution now carries:

```text
historySchemaVersion
```

and Core provides:

```ts
migrateExecutionHistory()
builtinHistoryMigrations
CURRENT_HISTORY_SCHEMA_VERSION
```

Current schema:

```text
3
```

The built-in migration chain currently supports:

```text
schema 1
→ schema 2
→ schema 3
```

Schema migrations are applied before RuntimeEngine resumes an execution.

Missing migration paths fail explicitly with:

```text
HistoryMigrationError
```

### Deployment model

The intended deployment policy becomes:

```text
normal deployment
  register current workflow versions

long-running old executions
  keep old workflow version registered
  OR
  define explicit compatibility upgrade

never
  silently replay old History through arbitrary new code
```

### SQLite persistence

SQLite now persists:

```text
workflow_version
history_schema_version
```

and performs additive `ALTER TABLE` migration for databases created by older UAIR versions.

Verified:

```text
workflowVersion = 7
historySchemaVersion = 3
```

after an actual SQLite save/load round trip.

### Verified production scenario

The v0.24 versioning example performs:

```text
start approval@1
↓
suspend
↓
deploy approval@2
↓
resolve old Suspension
↓
VersionedWorkflowRegistry contains v1 + v2
↓
old execution completes with v1 result
```

Then separately:

```text
start approval@1
↓
suspend
↓
deployment removes v1 code
↓
registry contains only v2
+
explicit v1→v2 upgrade
↓
old execution migrates
↓
workflow_upgraded written to History
↓
execution completes using v2
```

Both paths passed.


## Deployment identity / code fingerprint — v0.25

v0.25 closes the remaining deployment hole:

```text
workflowVersion stayed "2"
but code changed
```

Every new Execution now pins three identities:

```text
workflowVersion
deploymentId
workflowFingerprint
```

### Workflow fingerprint

UAIR computes a SHA-256 fingerprint from the deployed Workflow implementation unless build tooling supplies an explicit fingerprint.

```ts
workflow(
  "approval",
  {
    version: "2",
    deploymentId:
      "deploy-2026-08-20",
    fingerprint:
      buildGeneratedHash
  },
  handler
);
```

For local/dev use, omitted fingerprints are derived from the runtime handler source.

For production builds, explicit build-generated fingerprints are preferred because bundlers/minifiers can transform function source representation.

### Same version / different code is rejected

`VersionedWorkflowRegistry` now rejects:

```text
approval@2 fingerprint A
approval@2 fingerprint B
```

with:

```text
WorkflowFingerprintMismatchError
```

This detects accidental registration of two different code bodies under one durable workflow version.

### Execution resume identity check

An Execution created under:

```text
approval@2
fingerprint = abc...
```

cannot later resume against:

```text
approval@2
fingerprint = def...
```

Even though the human-written version string is unchanged.

UAIR throws:

```text
ExecutionDeploymentMismatchError
```

### Legacy identity adoption

Executions created before fingerprinting have no pinned code fingerprint.

On their first compatible resume under v0.25, UAIR:

```text
computes current fingerprint
pins it onto the Execution
records workflow_identity_adopted in History
persists before continuing
```

This converts legacy executions into fingerprint-protected executions without silently leaving them permanently unverified.

### Explicit workflow upgrades update identity

A registered workflow upgrade now changes:

```text
workflowVersion
workflowFingerprint
deploymentId
```

together.

The durable `workflow_upgraded` History event also records:

```text
fromFingerprint
toFingerprint
```

when available.

### Deployment manifest

Core now provides:

```ts
const manifest =
  createDeploymentManifest(
    "deploy-2026-08-20",
    workflows
  );
```

which records:

```text
deploymentId
workflow name
workflow version
workflow fingerprint
```

At startup/deployment validation:

```ts
verifyDeploymentManifest(
  manifest,
  actualWorkflows
);
```

fails immediately if the deployed code does not match the recorded deployment artifact.

### SQLite persistence

SQLite now persists:

```text
workflow_version
deployment_id
workflow_fingerprint
history_schema_version
```

and adds the new columns to older databases through additive migration.

Verified round trip:

```text
workflowVersion = 5
deploymentId = deploy-A
workflowFingerprint = SHA-256(...)
historySchemaVersion = 4
```

### History schema

Current durable History schema:

```text
4
```

Built-in migration chain:

```text
1 -> 2 -> 3 -> 4
```

### Identity model

The durable code identity is now:

```text
Execution
  workflowName
  workflowVersion
  workflowFingerprint
  deploymentId
```

Interpretation:

```text
workflowVersion
= developer compatibility contract

workflowFingerprint
= exact code identity

deploymentId
= release/build provenance
```

A version string alone is no longer trusted to prove code equality.


## Deployment / Worker Routing — v0.26

v0.26 moves version identity from storage validation into actual multi-deployment scheduling.

A resume job no longer needs to assume that every worker process loads every historical Workflow version.

### Execution route

Every Execution can be projected to:

```text
workflow
workflowVersion
deploymentId
workflowFingerprint
```

through:

```ts
routeForExecution(execution)
```

This route is the scheduling identity.

### Worker registration

Workers advertise exactly what durable code identities they can execute:

```ts
directory.register({
  workerId: "approval-v1-worker",

  capabilities: [
    {
      workflow: "approval",
      workflowVersion: "1",
      deploymentId: "deploy-v1",
      workflowFingerprint: "..."
    }
  ]
});
```

A worker claiming only:

```text
approval@1
```

is not sufficient when the Execution already has a pinned fingerprint/deployment.

Pinned identities require exact matching.

### DeploymentRouter

A resume job:

```text
executionId
reason
```

is converted into:

```text
executionId
reason
route
workerId
```

by:

```ts
DeploymentRouter
```

The router:

```text
loads Execution
↓
reads durable identity
↓
finds healthy compatible worker
↓
dispatches routed job
```

If none exists:

```text
NoCompatibleWorkerError
```

is raised instead of sending the execution to arbitrary newer code.

### Worker-side verification

Routing is not trusted by itself.

`RoutedWorker` reloads the Execution and checks again:

```text
job route
==
current durable Execution route
==
worker registration identity
==
locally registered Workflow version/fingerprint
```

Only then does it resume.

This prevents stale/misrouted jobs from bypassing deployment identity safety.

### Multi-version deployment model

Production can now run:

```text
worker pool A
  approval@1
  deploy-v1

worker pool B
  approval@2
  deploy-v2
```

while the scheduler routes:

```text
old execution pinned v1
→ pool A

new execution pinned v2
→ pool B
```

A single worker process no longer needs to retain all historical Workflow implementations.

### Deterministic selection

The current `WorkerDirectory.select()` uses deterministic worker-ID ordering when multiple compatible workers exist.

This is intentionally minimal.

A production scheduler can later replace selection policy with:

```text
load
queue depth
region
data locality
cost
worker health
capacity
```

without changing Execution routing identity.

### Verified routing scenario

The v0.26 example creates:

```text
approval@1 / deploy-v1
approval@2 / deploy-v2
```

and workers:

```text
worker-v1
  exact v1 fingerprint

worker-v2
  exact v2 fingerprint
```

Verified:

```text
v1 execution → worker-v1
v2 execution → worker-v2
```

A worker advertising the right workflow/version/deployment but a different fingerprint is rejected with:

```text
NoCompatibleWorkerError
```

`RoutedWorker` was also verified while loading only v1 code in its local `VersionedWorkflowRegistry`.


## Worker lifecycle / load-aware routing — v0.27

v0.27 adds the worker lifecycle needed for safe rolling deployments.

### Worker lifecycle

Workers now advertise:

```text
lifecycle:
  active
  draining
  offline

capacity
queueDepth
activeJobs
lastHeartbeatAt
heartbeatLeaseMs
```

Interpretation:

```text
active
  accepts resume jobs
  accepts new execution admission

draining
  accepts compatible resume jobs
  rejects new execution admission

offline
  accepts nothing
```

This allows an old deployment pool to stop receiving new work while still serving historical executions pinned to it.

### Heartbeat lease

`WorkerDirectory` treats a worker as unavailable when:

```text
now - lastHeartbeatAt > heartbeatLeaseMs
```

A dead process therefore leaves scheduling eligibility even if its registration record was not explicitly removed.

Workers renew liveness through:

```ts
directory.heartbeat(
  workerId,
  {
    queueDepth,
    activeJobs,
    capacity,
    lifecycle
  }
);
```

### Capacity

Scheduling uses:

```text
load = queueDepth + activeJobs
```

and rejects a worker when:

```text
load >= capacity
```

Capacity is therefore an admission boundary rather than only a ranking hint.

### Load-aware routing

When several workers have the exact same durable code identity, UAIR now prefers the lowest normalized load:

```text
(queueDepth + activeJobs) / capacity
```

Worker ID is only a deterministic tie-breaker.

This replaces the v0.26 placeholder policy that selected by worker ID alone.

### New execution vs resume intent

Routing now distinguishes:

```text
intent = resume
intent = new
```

A draining worker may still be selected for:

```text
resume
```

because old durable Executions may have no other compatible deployment.

It is excluded from:

```text
new
```

so a rolling deployment can stop creating additional obligations for an old worker pool.

`DeploymentRouter.selectForNewExecution()` exposes this admission decision for schedulers that choose a worker before creating a new Execution.

### Graceful drain

A draining worker becomes safe to terminate only when:

```text
queueDepth = 0
activeJobs = 0
```

through:

```ts
directory.canShutdown(workerId)
```

The intended rolling deployment becomes:

```text
deploy v2 pool
↓
mark v1 workers draining
↓
new Executions → v2 only
old v1 resumes → v1 workers
↓
v1 queueDepth → 0
v1 activeJobs → 0
↓
canShutdown(v1) = true
↓
terminate v1 pool
```

### Worker-side load accounting

`RoutedWorker` can now be attached to the same `WorkerDirectory`.

When it begins a routed job:

```text
queueDepth - 1
activeJobs + 1
```

and in `finally`:

```text
activeJobs - 1
```

so failed jobs do not leak active capacity.

### Verified behavior

The v0.27 routing example verifies:

```text
same deployment / same fingerprint:
  busy worker load = 9/10
  free worker load = 1/10
  → free worker selected

draining free worker:
  resume → draining worker remains eligible
  new execution → active worker selected

expired heartbeat:
  expired worker ignored
  live worker selected

worker at capacity:
  NoCompatibleWorkerError

draining worker with queued/active work:
  canShutdown = false

after queueDepth=0 and activeJobs=0:
  canShutdown = true
```

### Architectural result

The deployment model is now:

```text
Execution durable identity
        ↓
DeploymentRouter
        ↓
exact compatible worker set
        ↓
heartbeat / lifecycle / capacity filter
        ↓
load-aware selection
        ↓
RoutedWorker revalidation
```

Old deployment pools can remain alive only as long as durable historical work requires them.


## Reliable Scheduler Queue — v0.28

v0.28 makes routed resume jobs durable until a worker explicitly ACKs them.

The scheduling pipeline is now:

```text
ResumeJob
↓
DeploymentRouter
↓
exact worker identity selection
↓
Reliable routed queue
↓
claim + visibility lease
↓
worker execution
↓
ACK
```

A successful dispatch is no longer treated as successful execution.

### Job visibility lease

A worker claims a routed job and receives:

```text
jobId
leaseToken
leaseExpiresAt
attempt
```

Until ACK, the job remains owned by the queue.

If the worker disappears before ACK:

```text
visibility timeout
↓
lease expires
↓
reclaim
↓
route again against current WorkerDirectory
↓
compatible surviving worker
```

The old worker cannot later ACK with an expired/stale lease token.

### ACK / NACK

Success:

```text
claim
↓
handle
↓
ACK
↓
job permanently removed
```

Failure:

```text
claim
↓
handle throws
↓
NACK
↓
backoff
↓
redelivery
```

Queue-level delivery attempts are distinct from Component-level retry attempts.

This distinction is intentional:

```text
Component retry
= retry one logical effect inside an execution

Queue redelivery
= retry delivery of the entire resume job to a worker
```

### Backoff and dead-letter

The reference queue uses exponential backoff by default:

```text
100 ms
200 ms
400 ms
...
cap 60 s
```

After `maxAttempts`:

```text
state = dead
```

and the job remains available through:

```ts
queue.deadLetters()
```

instead of disappearing.

### Worker reclaim

A scheduler may immediately reclaim all leases owned by a known-dead worker:

```ts
queue.reclaimWorker(
  workerId
);
```

This avoids waiting for the full visibility timeout when worker failure is already known.

### No compatible worker

If a job becomes eligible for redelivery but no compatible worker currently exists, it remains durable with no assignment.

Later:

```ts
queue.routePending()
```

re-evaluates current worker health/capacity/version identity and assigns it when capacity becomes available.

Therefore temporary lack of worker capacity does not turn into job loss.

### SQLite durable queue

`@uair/sqlite` now exports:

```ts
SqliteReliableWorkerQueue
```

Its durable table stores:

```text
job_id
execution_id
assigned_worker_id
job_json
state
attempt
max_attempts
available_at
lease_owner
lease_token
lease_expires_at
last_error
created_at
updated_at
```

SQLite WAL + FULL synchronous mode are used by the reference implementation.

### Scheduler restart recovery

The critical crash scenario was verified:

```text
Scheduler process A
  dispatch job
  worker A claims job
  job stored as leased in SQLite

worker A dies before ACK
scheduler A exits

Scheduler process B
  opens same SQLite queue file
  rebuilds queue/active load projection
  visibility timeout expires
  worker A is offline
  job is rerouted to worker B
  worker B claims
  ACK
  durable row deleted
```

The job survives both worker failure and scheduler process restart.

### Load reconciliation

Because `WorkerDirectory` is an in-memory scheduling projection while job truth is durable, SQLite queue provides:

```ts
queue.reconcileDirectoryLoad();
```

It rebuilds per-worker:

```text
queueDepth
activeJobs
```

from durable queued/leased rows after scheduler restart.

### Reference vs production backends

`ReliableWorkerQueue` in `@uair/core` is an in-memory semantic reference implementation.

`SqliteReliableWorkerQueue` validates durable single-host semantics.

The same contract can later be implemented on:

```text
PostgreSQL SKIP LOCKED
Redis Streams
NATS JetStream
SQS
Kafka-compatible job transport
cloud task queues
```

without changing Workflow or Component semantics.


## JobQueue SPI + leaderless schedulers + PostgreSQL — v0.29

v0.29 separates reliable delivery semantics from their storage backend.

### JobQueue SPI

Core now exposes one asynchronous-compatible contract:

```ts
interface JobQueue extends WorkerDispatcher {
  list();
  deadLetters();
  claim(workerId, now?);
  ack(jobId, leaseToken, now?);
  nack(jobId, leaseToken, reason, now?);
  extendLease(jobId, leaseToken, now?);
  reclaimExpired(now?);
  reclaimWorker(workerId, now?);
  routePending(now?);
}
```

The return type permits either direct values or Promises, so the same worker consumer can use:

```text
in-memory queue
SQLite queue
PostgreSQL queue
future SQS / Redis Streams / JetStream adapter
```

without changing execution code.

`ReliableWorkerConsumer` now depends on `JobQueue`, not the in-memory implementation.

### SQLite remains a reference backend

`SqliteReliableWorkerQueue` now implements the same SPI.

A real two-process contention test was run against one SQLite file:

```text
process A claim ─┐
                 ├─ same durable job
process B claim ─┘

claim winners = 1
```

This verifies that queue abstraction did not weaken the existing durable claim semantics.

### Leaderless scheduler maintenance

Core now includes:

```ts
new LeaderlessQueueScheduler(queue)
```

whose maintenance tick performs:

```text
reclaimExpired()
routePending()
```

There is deliberately no scheduler leader-election primitive in Core.

Correctness belongs to atomic `JobQueue` backend state transitions, allowing multiple scheduler replicas to perform maintenance concurrently.

During v0.29 work a real race was found in the SQLite reference implementation: `reclaimExpired()` previously selected expired rows before updating them, which could allow two scheduler processes to observe the same expired lease.

It was changed to execute inside:

```text
BEGIN IMMEDIATE
  SELECT expired leases
  transition/re-route them
COMMIT
```

A two-process destructive test now verifies:

```text
scheduler A reclaimExpired ─┐
                            ├─ one expired lease
scheduler B reclaimExpired ─┘

A.reclaimed + B.reclaimed = 1
```

### @uair/postgres

A new reference package is included:

```text
@uair/postgres
```

with:

```ts
PostgresReliableWorkerQueue
POSTGRES_RELIABLE_QUEUE_SCHEMA
PgQueryable
```

The implementation deliberately depends only on a tiny `PgQueryable` interface rather than a concrete `pg` package. Applications may adapt their existing PostgreSQL driver/pool.

### Atomic PostgreSQL claim

The critical claim path uses one statement:

```sql
WITH candidate AS (
  SELECT job_id
  FROM uair_routed_jobs
  WHERE state = 'queued'
    AND assigned_worker_id = $1
    AND available_at <= $2
  ORDER BY available_at, created_at, job_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE uair_routed_jobs AS jobs
SET state = 'leased',
    attempt = jobs.attempt + 1,
    lease_owner = $1,
    lease_token = $3,
    lease_expires_at = $4
FROM candidate
WHERE jobs.job_id = candidate.job_id
RETURNING jobs.*;
```

This is the basis of leaderless concurrent claiming:

```text
Scheduler/Worker A ─┐
Scheduler/Worker B ─┼─ PostgreSQL row locks + SKIP LOCKED
Scheduler/Worker C ─┘
```

No central queue leader is required to serialize claims.

Expired PostgreSQL leases also use `FOR UPDATE SKIP LOCKED` before transition, so concurrent maintenance workers partition expired rows rather than all attempting to reclaim the same rows.

### Important verification boundary

The current environment does not contain a running PostgreSQL server or the `pg` driver.

Therefore v0.29 verifies:

```text
PostgreSQL package TypeScript compilation
JobQueue SPI compatibility
exact atomic claim SQL contract
presence of FOR UPDATE SKIP LOCKED
UPDATE ... RETURNING claim transition
```

but does **not** claim a live PostgreSQL multi-connection integration test in this environment.

The live PostgreSQL contention suite should run in CI against a real PostgreSQL service before calling the backend production-ready.

### Cluster model after v0.29

```text
                   durable JobQueue
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     Scheduler A    Scheduler B    Scheduler C
          │              │              │
          └──── leaderless maintenance ─┘
                         │
                 atomic claim/leases
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
       Worker A       Worker B       Worker C
```

Execution correctness remains a second layer:

```text
JobQueue at-least-once delivery
+
Execution lease/fencing
+
History replay/effect identity
=
crash-safe logical execution
```


## Shared Worker Registry — v0.30

v0.30 moves Worker discovery and load state from scheduler-local memory into a shared registry.

The cluster now has two independent shared planes:

```text
JobQueue
  durable jobs / leases / ack / redelivery

SharedWorkerRegistry
  worker heartbeat / capabilities / lifecycle / capacity / load
```

Schedulers no longer need to exchange worker state with each other.

### SharedWorkerRegistry SPI

Core defines:

```ts
interface SharedWorkerRegistry {
  register(...)
  heartbeat(...)
  setLifecycle(...)
  remove(...)
  list(...)
}
```

A worker publishes:

```text
workerId
capabilities
lifecycle
capacity
queueDepth
activeJobs
lastHeartbeatAt
heartbeatLeaseMs
metadata
```

The heartbeat record is the shared scheduling truth. Scheduler-local `WorkerDirectory` instances are disposable projections.

### Shared scheduling snapshot

Each scheduler can independently call:

```ts
const directory =
  await snapshotWorkerDirectory(
    registry
  );
```

or:

```ts
await syncWorkerDirectory(
  registry,
  localDirectory
);
```

Then normal routing semantics remain unchanged:

```text
identity match
→ heartbeat lease
→ lifecycle
→ capacity
→ normalized load
→ deterministic tie-break
```

### SharedRegistryQueueScheduler

A scheduler tick now supports:

```text
read SharedWorkerRegistry
↓
replace local routing snapshot
↓
reclaim expired jobs
↓
refresh shared worker snapshot again
↓
route pending jobs
```

This lets SQLite/Postgres JobQueue implementations keep using the existing synchronous `WorkerDirectory` routing engine while multiple Scheduler instances share one durable worker-discovery source.

### SQLite implementation

`@uair/sqlite` now exports:

```ts
SqliteWorkerRegistry
```

It persists:

```text
worker_id
capabilities_json
lifecycle
capacity
queue_depth
active_jobs
last_heartbeat_at
heartbeat_lease_ms
metadata_json
updated_at
```

WAL mode + busy timeout allow multiple Scheduler/Worker processes to share the registry file.

Verified cross-process behavior:

```text
Process A
  register worker

Process B
  opens same SQLite registry
  sees capabilities/load
  sets draining
  publishes queueDepth=0 / activeJobs=0

subsequent reads
  see the updated shared state
```

### PostgreSQL implementation

`@uair/postgres` now exports:

```ts
PostgresWorkerRegistry
POSTGRES_WORKER_REGISTRY_SCHEMA
```

Worker registration uses:

```sql
INSERT ...
ON CONFLICT(worker_id)
DO UPDATE ...
```

so heartbeat/load publication is an atomic shared-row update.

The PostgreSQL registry remains driver-neutral through `PgQueryable`.

### Rolling deployment semantics across schedulers

Shared lifecycle state now means every Scheduler sees the same transition:

```text
worker-v1 = active
↓
registry.setLifecycle(v1, draining)
↓
Scheduler A sees draining
Scheduler B sees draining
Scheduler C sees draining
```

Therefore:

```text
old v1 resume
→ v1 remains eligible

new execution admission
→ v1 excluded
```

without broadcasting a scheduler-specific drain command.

### Load-aware shared routing

If heartbeat state says:

```text
worker-a
capacity 10
queueDepth 7
activeJobs 2

worker-b
capacity 10
queueDepth 1
activeJobs 0
```

all schedulers independently choose `worker-b` from the same shared data.

A later heartbeat changing those counters immediately changes routing decisions for every scheduler on its next snapshot refresh.

### Architecture after v0.30

```text
                    Shared Database
                ┌─────────┴─────────┐
                ↓                   ↓
             JobQueue        WorkerRegistry
                │                   │
       durable delivery       cluster presence
       leases / retry         load / draining
                │                   │
                └─────────┬─────────┘
                          ↓
              Scheduler A / B / C
                    no leader
                          ↓
                    Worker Pools
```

Scheduler memory is now cache/projection rather than cluster truth.


## Atomic capacity reservation — v0.31

v0.31 closes the multi-scheduler admission race where two schedulers can both observe the same final worker capacity slot.

### SharedWorkerRegistry reservation API

The shared worker registry now provides:

```ts
reserveCapacity(route, {
  intent: "resume" | "new"
})

releaseCapacity(reservation)
```

`reserveCapacity()` is not `select()` followed by a later counter update.
It must atomically:

```text
match workflow/version/deployment/fingerprint
+ validate heartbeat/lifecycle
+ validate load < capacity
+ select the preferred compatible worker
+ increment shared queueDepth
```

as one storage transaction/statement.

### Scheduler admission flow

A new `AtomicCapacityQueueScheduler` routes unassigned jobs using:

```text
JobQueue.unassigned()
↓
SharedWorkerRegistry.reserveCapacity()
↓
JobQueue.assign(jobId, workerId)
↓
if assign lost a race:
  releaseCapacity()
```

This protects two independent races:

```text
same job selected by two schedulers
and
same last worker slot selected by two schedulers
```

`JobQueue` therefore adds two small backend-neutral primitives:

```ts
unassigned(now?)
assign(jobId, workerId, now?)
```

Existing `routePending()` remains for compatibility, but the shared-registry production path should use `AtomicCapacityQueueScheduler`.

### SQLite atomic reservation

`SqliteWorkerRegistry.reserveCapacity()` uses:

```text
BEGIN IMMEDIATE
↓
read shared worker state
↓
run existing WorkerDirectory selection logic
↓
conditional UPDATE
  queue_depth = queue_depth + 1
  WHERE queue_depth + active_jobs < capacity
↓
COMMIT
```

The write transaction serializes competing schedulers across processes.

Cross-process verification with `capacity = 1`:

```text
Process A reserve → worker-one
Process B reserve → NONE

winners = 1
shared queueDepth = 1
```

### PostgreSQL atomic reservation

`PostgresWorkerRegistry.reserveCapacity()` performs the admission in one statement built around:

```sql
WITH candidate AS (
  SELECT worker_id
  FROM uair_worker_registry
  WHERE ...
    AND queue_depth + active_jobs < capacity
  ORDER BY load_ratio, worker_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE uair_worker_registry AS workers
SET queue_depth = workers.queue_depth + 1
FROM candidate
WHERE workers.worker_id = candidate.worker_id
  AND workers.queue_depth + workers.active_jobs < workers.capacity
RETURNING workers.worker_id;
```

This makes multiple PostgreSQL schedulers leaderless while preventing final-slot over-admission.

### Reservation and heartbeat

The reservation is represented by the shared `queueDepth + 1` itself rather than a second reservation ledger.

If dispatch/conditional assignment fails, the scheduler calls:

```ts
releaseCapacity(reservation)
```

Worker heartbeat remains the reconciliation mechanism for actual worker load.

### Redelivery scheduling

Retry/reclaim now returns jobs to an **unassigned queued state** before scheduling. This avoids bypassing atomic shared-registry admission during redelivery.

The intended production path is therefore:

```text
reclaim expired lease
↓
unassigned queued job
↓
atomic reserveCapacity
↓
conditional job assign
↓
worker claim
```

### Verified capacity race

Two schedulers operating on the same SQLite queue and registry with:

```text
worker capacity = 1
two pending jobs
```

were run concurrently.

Verified:

```text
routed by scheduler A + routed by scheduler B = 1
assigned jobs = 1
unassigned jobs = 1
shared queueDepth = 1
```

After a worker heartbeat reports `queueDepth = 0`, the next scheduler tick admits the second job.

Architectural result:

> worker selection and capacity admission are now one shared-storage operation; routing no longer relies on a stale read followed by a non-atomic local increment.


## Cluster Chaos Harness — v0.32

v0.32 stops adding scheduler mechanisms and attacks the existing cluster model as a system.

A deterministic, seedable harness now lives at:

```text
examples/chaos-harness
```

Run:

```bash
npm run chaos
```

Optional controls:

```bash
UAIR_CHAOS_SEED=21 \
UAIR_CHAOS_EXECUTIONS_PER_VERSION=20 \
npm run chaos
```

### Scenario topology

The harness runs against shared SQLite state with:

```text
3 leaderless schedulers
4 workers
2 workflow deployments (v1 + v2)
shared Runtime state
shared Reliable JobQueue
shared WorkerRegistry
capacity reservation
visibility leases
```

Every workflow performs:

```text
blocking approval Suspension
↓
seeded transient Component retry
↓
external non-idempotent side effect
↓
Execution completion
```

The external side effect intentionally writes one row per handler invocation to a separate SQLite database. It is not protected by `INSERT OR IGNORE` or a business idempotency key, so duplicate handler execution is observable.

### Injected failures

The harness deterministically injects:

```text
worker crash after Execution handling but before queue ACK
heartbeat loss / worker offline
visibility timeout
lease reclaim + redelivery
worker restart after expiry window
rolling-deploy draining of a v1 worker
capacity=1 contention across multiple schedulers
Component transient retry
v1/v2 deployment routing
```

The most important case is:

```text
Worker handles resume
↓
external side effect commits
↓
Execution History persists completed effect
↓
worker crashes before ACK
↓
job lease expires
↓
job is redelivered
↓
workflow replays from durable History
↓
external side-effect handler is NOT called twice
```

### Invariants

Every chaos run asserts:

```text
all Executions eventually complete
all reliable jobs eventually ACK
no unexpected DLQ entries
exactly one external side-effect invocation per business execution
expected transient retries are recorded durably
at least one crash-after-handle-before-ACK is exercised
at least one lease is reclaimed/redelivered
shared worker load never exceeds declared capacity
```

### Verified seed

Default seed result:

```text
seed = 195936478
executions = 16
completed = 16
sideEffects = 16
retryFailures = 6
crashAfterHandleCount = 3
reclaimedCount = 3
maxObservedLoadRatio = 1
deadLetters = 0
```

### Soak verification

A 12-seed deterministic soak was also executed:

```text
seeds = 12
total Executions = 144
crash-after-handle events = 36
lease reclaims = 36
max observed load ratio = 1
DLQ entries = 0
```

Each individual seed independently asserted exactly one external side-effect invocation per completed business execution.

### Failure discovered while building the harness

The first chaos run left one Execution suspended. Inspection showed no data loss: the harness had randomly killed every compatible worker in that workflow-version pool and never restarted one.

The fault model was corrected to distinguish:

```text
worker instance crash
!=
permanent deletion of the compatible deployment
```

Offline instances now restart after heartbeat/visibility expiry, while `v1-a` preserves its `draining` lifecycle after restart.

This is a useful liveness distinction for production: UAIR can durably preserve work while no compatible worker exists, but eventual completion still requires compatible capacity to return.

### Current claim

The harness supports a stronger statement than the previous component tests:

> Under the tested SQLite cluster failure model, routed job delivery remains at-least-once while durable workflow replay prevents duplicate execution of completed Component side effects, worker capacity is not oversold, and compatible work survives worker loss until capacity returns.

This is still not a proof of correctness for arbitrary distributed failure models. PostgreSQL process/network partition chaos remains a separate CI requirement.


## v1-alpha hardening — v0.33

No new runtime primitive was added. The release focuses on reducing accidental API surface and documenting release gates.

`@uair/core` is now split into explicit entry points:

```text
@uair/core           application API
@uair/core/runtime   storage/versioning/deployment tooling
@uair/core/cluster   workers/queues/schedulers
@uair/core/internal  fencing/lock implementation details
```

The root entry intentionally no longer exports raw History, fencing, storage backend internals, or cluster scheduler types. `npm run check:api` fails if reviewed internal/cluster symbols leak back into the application root.

See:

```text
../../release/v1-alpha-api.md
../../release/v1-alpha-hardening.md
../../operations/test-matrix.md
../../release/checklist.md
```

Current status: **v1-alpha candidate**, explicitly **not production-ready** until the remaining PostgreSQL, real-process-kill, large-soak, migration-fixture, and real-sandbox gates are completed.


## Real PostgreSQL integration gate — v0.34

v0.34 intentionally adds no new runtime primitive.

Its purpose is to turn the PostgreSQL concurrency design into an executable release gate.

A new real-database harness lives at:

```text
examples/postgres-integration/index.mjs
```

and a GitHub Actions service job lives at:

```text
.github/workflows/postgres-integration.yml
```

The CI job starts a real:

```text
postgres:16
```

service and opens multiple independent PostgreSQL connections.

The harness verifies five concurrency properties:

```text
1. one job / many claimers
   → exactly one claim winner

2. one expired lease / many reclaimers
   → exactly one lease transition

3. shared worker registry
   → state written on connection A is visible on connection B

4. capacity = 1 / many reservers
   → exactly one reservation winner

5. two AtomicCapacityQueueSchedulers / two jobs / one capacity slot
   → exactly one job assigned
   → one job remains unassigned
   → shared queueDepth = 1
```

The claim and reservation paths under test are the real `@uair/postgres` implementations, including:

```text
FOR UPDATE SKIP LOCKED
UPDATE ... RETURNING
conditional capacity checks
shared worker registry rows
```

### Local verification boundary

The artifact-generation environment used for v0.34 did not provide:

```text
postgres
psql
docker / podman
node pg driver
```

Therefore the real PostgreSQL harness could not be executed locally.

What was executed locally:

```text
full TypeScript build                     PASS
v1-alpha API surface check               PASS
SQLite Chaos regression                  PASS
PostgreSQL integration harness syntax    PASS
PostgreSQL CI gate contract check        PASS
```

The repository MUST NOT treat v0.34 as having a green PostgreSQL integration result until the GitHub Actions PostgreSQL service job actually passes.

This distinction is intentional:

> an executable real-database gate is stronger than a SQL design review, but an authored gate is still not the same thing as an observed green run.
