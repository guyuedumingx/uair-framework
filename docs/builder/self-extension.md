# AI Builder Self-Extension

UAIR Builder can now plan and govern capability expansion without adding a new
Runtime Core primitive.

The order is fixed:

```text
Project provider
→ already executable package / connected MCP
→ trusted installable package
→ generate only when no safe reusable candidate exists
```

In short:

```text
Reuse → Install → Generate
```

## Build-time resolution

Builder receives required `CapabilityNeed`s from the requirement analysis.

A `CapabilityResolutionPlanner` turns the architectural plan into explicit
resolution evidence:

```text
existing
mcp
install
generate
```

Example install evidence:

```json
{
  "id": "attendance.update",
  "selected": "install",
  "candidate": {
    "sourceName": "@acme/attendance-kit",
    "packageVersion": "2.4.0",
    "exportName": "updateAttendance"
  }
}
```

The candidate package then contains the dependency and imports the public
provider export. It must not redeclare the same durable Component ID locally.

## Required capability materialization

A required capability cannot pass merely because it exists in a planning JSON
object.

Before proposal creation, Builder verifies that each generated capability is
actually declared in candidate source, while reused/install/MCP capabilities
have an explicit provider.

This prevents a paper-only architecture where a required integration is planned
but missing from executable code.

## Extension plan

Installable capabilities produce a separate `CapabilityExtensionPlan`:

```text
BuildPlan
→ CapabilityResolutionReport
→ CapabilityExtensionPlan
```

The plan is release evidence. Build does not silently install anything.

## Explicit acquisition authorization

`ExtensionController` is separate from Builder execution:

```text
uair build
→ proposal

uair extensions
→ review required package acquisitions

uair extend --approve
→ acquisition adapter may run
```

Without explicit approval:

```text
extend
→ FAIL
```

If a required extension has not been acquired, release is blocked:

```text
uair release --approve
→ FAIL: required capability extensions not ready
```

Only after extension evidence is satisfied can release continue.

## Trusted download path

Production acquisition can bridge:

```text
ExtensionController
→ FunctionExtensionAdapter
→ TrustedPackageAcquirer
→ PackageTrustPolicy
→ SandboxedPackageInstaller
→ SandboxRunner
```

The sandboxed installer defaults to:

```text
lifecycle scripts: disabled
network: registry-only (or stricter policy)
filesystem: isolated
ambient secrets: none
native addons: denied unless explicitly trusted
```

The CLI's default `LocalReceiptExtensionAdapter` deliberately does not pretend
to provide OS isolation. Real hosts should inject the trusted sandbox adapter.

## Package catalog

The resolver uses the existing `PackageCatalog` interface. A remote company
marketplace, npm-backed index, private registry, or enterprise catalog can
implement that interface.

For deterministic local development the CLI accepts a JSON catalog:

```bash
uair build \
  --requirement "..." \
  --catalog uair.catalog.json
```

Example:

```json
[
  {
    "packageName": "@acme/attendance-kit",
    "version": "2.4.0",
    "capabilities": [
      {
        "id": "attendance.update",
        "description": "write attendance",
        "metadata": {
          "exportName": "updateAttendance"
        }
      }
    ]
  }
]
```

`exportName` is required for Builder to safely wire an installable TypeScript
provider into generated source. A candidate that cannot be deterministically
integrated does not automatically win over generation.

## Generated capability path

If no safe reusable/installable candidate exists:

```text
selected = generate
```

The candidate package contains the generated Component implementation and no
external extension action is required.

The same Builder already generates the surrounding package, Workflow, Surface
contracts and tests, so the AI can evolve fixed business applications as
ordinary UAIR packages rather than mutating Runtime Core.

## Forge alignment

`@uair/forge` now follows the same order.

Previously it could discover an installable package but jump directly to code
synthesis because only executable candidates were selected.

The current self-extension flow fixes that:

```text
executable existing
→ trusted installable acquisition
→ synthesize package only if still missing
```

## Authority boundaries

AI may:

```text
analyze requirements
search capability catalogs
select a candidate
write package/workflow/ui code
propose an install
propose a release
```

AI may not bypass:

```text
trust policy
sandbox policy
architecture governance
contract compatibility
migration/deployment gates
explicit extension approval
explicit release approval
```

This is the intended self-extension model:

> AI can make the software richer; deterministic policy remains authoritative.
