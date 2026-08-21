# Versioning Policy

UAIR uses SemVer for npm packages and a separate durable version for Workflows.

## Workspace package versions

During the alpha line, publishable UAIR workspace packages use one synchronized
framework version:

```text
@uair/core        0.67.0
@uair/ui          0.67.0
@uair/agent       0.67.0
...
```

This keeps compatibility testing and release provenance easy to reason about.

## Before 1.0

SemVer rules still matter, but `0.x` communicates that provisional outer APIs
may change.

Policy:

```text
patch
→ backwards-compatible bug/security/docs fixes

minor
→ additive features and any documented breaking change to provisional APIs
```

Candidate v1 application APIs receive a stronger compatibility expectation even
before 1.0.

Breaking changes must be recorded in:

```text
CHANGELOG.md
migration/upgrade documentation when action is required
compatibility snapshots/tests when applicable
```

## After 1.0

Standard SemVer applies:

```text
major
→ breaking public API changes

minor
→ backwards-compatible features

patch
→ backwards-compatible fixes
```

## Workflow durable version is different

npm package version:

```text
@company/commerce@2.4.0
```

does not replace durable Workflow identity/version:

```text
commerce.checkout@3
```

Package SemVer answers:

```text
which software release is installed?
```

Workflow version answers:

```text
which durable code contract owns this persisted execution/history?
```

Do not derive Workflow versions automatically from package SemVer.

## Storage schema versions

Physical storage schema versions are internal adapter compatibility mechanisms,
not application package versions and not Workflow versions.
