# UAIR ProjectGraph — v0.60

ProjectGraph gives Builder a structural view of an existing UAIR codebase without introducing another project DSL.

## Source of truth

The v0.44 filesystem inspector reads:

```text
package.json
TypeScript / JavaScript source
```

and extracts stable UAIR identities:

```text
Package
Workflow + version
Component
Capability
Surface
package imports
```

Example:

```text
@acme/leave
├─ Workflow
│  └─ hr.leave.request@2
├─ Component
│  └─ leave.balance.read
└─ Surface
   └─ hr.leave.manager-approval
```

The resulting graph contains nodes and edges:

```ts
ProjectGraph {
  nodes
  edges
}
```

Node kinds:

```text
package
workflow
component
surface
capability
```

Edge kinds:

```text
contains
imports
uses
```

v0.44 implements `contains` and package-level `imports` directly. Deeper symbol-level `uses` resolution is intentionally left for a later AST/language-service implementation.

## Why stable IDs matter

ProjectGraph does not treat variable names as application identity.

It extracts:

```ts
workflow({
  id: "hr.leave.request",
  version: "2"
});
```

rather than:

```text
variable name
filename
Function.name
```

so Builder reasons about the same durable identities Runtime persists.

## Inventory projection

```ts
const graph =
  await buildProjectGraph(
    projectRoot
  );

const inventory =
  inventoryFromProjectGraph(
    graph
  );
```

This gives the existing Builder interfaces:

```text
packages
capabilities
workflows + versions
surfaces
```

without forcing every Builder phase to understand graph internals.

## FsProjectGraphInspector

```ts
const inspector =
  new FsProjectGraphInspector(
    projectRoot
  );

const inventory =
  await inspector.inspect();

const graph =
  inspector.currentGraph();
```

This replaces the v0.43 requirement to hand-construct project inventory.

## Runtime impact is separate

Source code answers:

```text
what exists?
```

Runtime storage answers:

```text
what is currently executing?
```

Builder combines both.

See `overview.md`.


## v0.45 — TypeScript symbol analysis

The scanner now uses the TypeScript compiler API.

It records `uses` edges for actual resolved calls rather than inferring them from string co-occurrence.

Verified cross-file relationship:

```text
workflow:hr.leave.request
→ component:leave.balance.read
```

where the Component is imported from another source file.

Semantic `surface({...})` calls also become `uses` edges.

Nodes now include implementation fingerprints so same-ID implementation changes are visible to ChangeSet analysis.


## v0.60 — architecture governance

ProjectGraph is now also the source for deterministic architecture governance.

```ts
const graph =
  await buildProjectGraph(
    projectRoot
  );

const governance =
  await analyzeProjectGovernance(
    graph
  );

const impact =
  analyzeProjectImpact(
    graph,
    "component:payment.charge"
  );

const mermaid =
  renderProjectGraphMermaid(
    graph
  );
```

ProjectGraph preserves duplicate declaration evidence so duplicate durable IDs
cannot be silently deduplicated by analysis.

Builder candidates run governance automatically. Hard architecture errors block
the proposal; warnings remain advisory.
