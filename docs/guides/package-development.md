# Package Development

UAIR packages are normal npm packages with an optional public UAIR contract.

They add reusable capabilities without expanding Runtime Core.

A package may provide:

```text
Components
Workflows
Capabilities
Surfaces/interactions
adapters
domain helpers
```

UAIR intentionally does **not** create a parallel package manager or registry.

## Create

```bash
uair package create @acme/risk-kit \
  --dir packages/risk-kit \
  --capability risk.score
```

The scaffold includes:

```text
package.json
tsconfig.json
src/index.ts
src/uair.ts
README.md
```

and exports a standard subpath:

```text
@acme/risk-kit/uair
```

## Verify

```bash
uair package verify --dir packages/risk-kit
```

Verification runs:

```text
npm build (if present)
npm test (if present)
npm pack --dry-run
UAIR manifest load + validation
package name/version consistency
```

The package manifest validates stable public IDs and rejects duplicate
Workflow/Component/Capability IDs inside one package contract.

## Pack

```bash
uair package pack --dir packages/risk-kit
```

This uses normal `npm pack` and records the immutable tarball path/integrity in
package lifecycle state.

## Catalog record

```bash
uair package catalog \
  --dir packages/risk-kit \
  --output package-catalog/risk-kit.json
```

A catalog record contains:

```text
package name
package version
capability IDs
descriptions/tags
public export metadata
```

`PackageCatalog` remains an interface. A company can back it with:

```text
static JSON
private npm registry metadata
internal service
marketplace
```

without changing Runtime Core.

## Publish

Publish is deliberately gated:

```text
same version verified
AND
same version packed
AND
explicit approval
AND
real publish adapter enabled
```

The CLI requires both:

```bash
uair package publish \
  --dir packages/risk-kit \
  --approve \
  --npm-publish
```

Optional:

```bash
--registry <registry>
--tag <tag>
```

Without `--npm-publish`, real registry publication is disabled even if
`--approve` is present.

The CLI publishes the recorded packed tarball rather than rebuilding from a
possibly modified working tree.

## Install / upgrade / rollback

```bash
uair package install @acme/risk-kit 1.0.0 --approve

uair package upgrade @acme/risk-kit 1.1.0 --approve

uair package rollback @acme/risk-kit --approve
```

All use normal npm version semantics.

UAIR adds lifecycle receipts:

```text
installed
upgraded
rolled-back
```

but npm remains responsible for the actual dependency graph, lockfiles and
registry protocol.

## Status

```bash
uair package status --name @acme/risk-kit
```

The state records:

```text
currentVersion
previousVersion
verify receipt
pack artifact/integrity
publish receipt
install/upgrade/rollback history
```

## Builder / AI

AI Builder uses the same ecosystem model:

```text
Reuse existing capability
→ discover package
→ install if trustworthy/approved
→ generate only if still missing
```

AI may propose package actions, but package acquisition and publication remain
separately authorized.

## Guidelines

- use stable public capability IDs;
- keep implementation details private;
- expose public integration metadata (`exportName`) for reusable capabilities;
- declare trust-sensitive metadata;
- do not expose undocumented `dist/*` deep imports;
- add compatibility tests for public exports;
- do not add domain concepts to Core to support one package.
