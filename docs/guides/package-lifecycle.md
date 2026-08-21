# Package Lifecycle

UAIR's package lifecycle is a governance layer over npm.

```text
create
→ verify
→ pack
→ publish
→ discover
→ install
→ upgrade
→ rollback
```

It is not a new package manager.

## State

`PackageLifecycleController` stores receipts for lifecycle transitions.

The state is operational evidence, not Runtime Workflow History.

## Safety properties

```text
publish requires explicit approval
install/upgrade require explicit approval
rollback requires explicit approval
publish requires verify + pack for the same version
same-version install is idempotent
repeated successful publish is idempotent
repeated rollback is idempotent
rollback targets the recorded previous version
real npm publish is disabled by default
```

## Separation from AI Builder

Builder may produce:

```text
CapabilityExtensionPlan
```

Package lifecycle executes approved package operations.

The model cannot silently convert a discovery recommendation into a registry
publication or host installation.

## Registry model

UAIR uses the npm ecosystem for distribution.

`PackageCatalog` is discovery-only and may be backed by internal/private
metadata. It does not replace npm's install/version/lockfile semantics.
