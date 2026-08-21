# Contributing to UAIR

UAIR welcomes fixes, adapters, tests, documentation and packages.

Start with:

```text
README.md
docs/architecture/layers.md
docs/maintainers/architecture-boundaries.md
docs/maintainers/durable-contracts.md
```

## Pull-request checklist

### Architecture

- [ ] This change does not add a new Core primitive.
- [ ] If it does, the PR explains why an outer package/adapter cannot express it.
- [ ] Domain concepts stay outside Core.
- [ ] External framework state ownership remains external.

### Durable compatibility

- [ ] Stable Workflow/Component IDs are preserved.
- [ ] Version changes are intentional.
- [ ] Old suspended Executions are considered.
- [ ] Storage/History schema compatibility is tested where relevant.
- [ ] Rollback behavior is documented.

### Security

- [ ] No raw secrets are intentionally persisted.
- [ ] Authorization is enforced at invocation/read/write boundaries, not only UI.
- [ ] Network/process/package inputs fail closed where relevant.
- [ ] Tenant identifiers are not treated as authentication.

### Quality

- [ ] `uair lint` has no hard architecture errors.
- [ ] Review `uair impact <changed-node>` for shared durable nodes when relevant.
- [ ] TypeScript build passes.
- [ ] Relevant focused tests pass.
- [ ] Public API snapshots are updated for intended changes.
- [ ] Documentation/examples are updated.
- [ ] `npm pack --dry-run` is clean for changed packages.

## Adding adapters and storage

See:

```text
docs/maintainers/adding-adapter.md
docs/maintainers/adding-storage.md
```

## Release process

See:

```text
docs/maintainers/release-process.md
docs/release/mac-validation.md
```


## Package changes

For a reusable/package-facing change:

```bash
uair package verify --dir <package>
uair package pack --dir <package>
```

Public package contracts should expose stable IDs and public export metadata.
Do not depend on another package's private `src/`, `internal/`, or `dist/`
implementation paths.
