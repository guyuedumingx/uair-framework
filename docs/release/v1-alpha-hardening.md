# UAIR v1-alpha Hardening Review

## Result

The current architecture is suitable to label **v1-alpha candidate**, not production-ready.

The main risk is no longer missing runtime primitives. The main risk is accidentally freezing implementation details or adding abstractions faster than they are justified by production evidence.

## Abstractions to keep

```text
Workflow
Component
Suspension
History
Execution
Capability (ecosystem layer)
```

These have survived materially different integrations: ordinary side effects, MCP, UI, LLM, Agent, RBAC/OA packages, dynamic package capabilities, durable replay, and cluster routing.

## Abstractions to keep out of the kernel

```text
Agent node types
MCP node types
UI node types
RBAC primitives
package manager primitives
OpenTelemetry SDK types
scheduler/worker concepts
```

They already map successfully onto the small kernel.

## APIs intentionally demoted from the root package

Before v1-alpha, these were exposed from `@uair/core` and risked becoming accidental application contracts:

```text
raw History types
Storage internals
Inbox/Outbox record types
fencing functions
durable queue APIs
WorkerDirectory
SharedWorkerRegistry
scheduler classes
```

They now live under explicit `runtime`, `cluster`, or `internal` subpaths.

## Concepts to question before adding more

### UairApplication

Useful as a composition convenience, but not required by runtime semantics. Do not turn it into a dependency-injection container or application lifecycle framework.

### PackageDiscovery vs CapabilityResolver

They overlap. Before v1 stable, prefer `CapabilityResolver` as the product-facing concept and treat `PackageDiscovery` as a lower-level catalog helper unless distinct user workflows justify both.

### Generic acquirePackage()

This API is too easy to use without trust/sandbox policy. For product documentation, prefer trusted/sandboxed acquisition paths. Consider removing or clearly marking generic acquisition as low-level before v1 stable.

### @uair/oa

Keep as an example/domain package, not a framework primitive. It proves composition; it should not influence Core API design.

### Cluster scheduler classes

Current implementations are reference orchestration components. Avoid promising their exact class hierarchy as the final distributed-control-plane API until PostgreSQL chaos testing is complete.

## Stop conditions for new kernel features

A new Core primitive should require evidence that:

1. At least two materially different use cases cannot map to existing primitives without semantic loss.
2. The missing behavior is durable execution semantics, not adapter convenience.
3. It cannot live in an ecosystem package.
4. It survives crash/replay/versioning analysis.

If these conditions are not met, do not add it to Core.


## v0.34 evidence update

A real PostgreSQL multi-connection test harness and CI service definition now exist.

This reduces the PostgreSQL gap from:

```text
no executable integration test
```

to:

```text
executable real-database gate authored
but not yet observed green in this local environment
```

The release gate remains open until a real PostgreSQL CI run passes.
