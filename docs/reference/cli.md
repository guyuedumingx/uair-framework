# UAIR CLI — v0.49

Install:

```bash
npm install -D @uair/cli
```

The package exposes:

```text
uair
```

## Build

Codex is the default Builder backend in v0.50.

```bash
uair build \
  --requirement "把超过3天审批改成超过2天" \
  --scope acme \
  --package @acme/leave
```

Optional Runtime storage location:

```bash
--runtime .uair/runtime
```

Build performs the full project-aware Builder pipeline:

```text
ProjectGraph
ChangeSet
Contract Compatibility
Runtime Impact
Migration Plan
Deployment Plan
```

and writes:

```text
.uair/build/release-proposal.json
.uair/build/candidate/
.uair/release/release-state.json
```

Candidate output includes generated business artifacts plus:

```text
migration/version-isolation.json
deployment/release-plan.json
```

when applicable.

## Review

```bash
uair review
```

Outputs a concise release summary:

```text
package
verification
changeSafe
contractCompatible
migration
deploymentReady
runtimeRisk
target
retireGate
```

## Release

```bash
uair release --approve
```

Without `--approve`:

```text
Release requires explicit approval.
```

v0.49's default adapter creates a local deploy receipt. It does not perform real cloud deployment.

## Status

```bash
uair status
```

Status reports:

```text
proposal | released | retired

releaseReady
retireReady
target
previous
fresh old-version runtime counts
```

## Retire

```bash
uair retire --approve
```

Retirement is rejected while any execution remains:

```text
running on the old Workflow version
suspended on the old Workflow version
```

When the old version drains, the same command becomes eligible.

## Why `retire` is separate

This is intentionally not:

```text
deploy v3
→ delete v2
```

It is:

```text
deploy v3
→ route new traffic
→ preserve v2
→ observe durable execution drain
→ separately authorize v2 retirement
```

That distinction is necessary for long-running Agent/business workflows.


## Codex backend

Default:

```bash
uair build \
  --requirement "..." \
  --backend codex
```

Optional executable/model override:

```bash
uair build \
  --codex-bin /path/to/codex \
  --model gpt-5.6-sol \
  --requirement "..."
```

For deterministic regression/testing:

```bash
uair build \
  --backend deterministic \
  --requirement "..."
```

Codex mode does not silently downgrade to deterministic generation when the executable or authentication is unavailable.
