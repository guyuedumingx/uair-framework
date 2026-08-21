# UAIR Codex Backend — v0.50

v0.50 replaces the Builder's AI-facing phases with an optional real Codex CLI backend.

The deterministic backend remains available as a reproducible protocol/test baseline.

## Why Codex is not the release authority

Codex is responsible for:

```text
RequirementAnalyst
SolutionArchitect
ArtifactImplementer
```

UAIR remains responsible for:

```text
Artifact Verification
ChangeSet
Contract Compatibility
Runtime Impact
Migration Planning
Deployment Planning
Release Controller
```

The coding model can propose code. It cannot bypass release safety.

## Official non-interactive Codex entry point

The backend invokes:

```bash
codex exec \
  --ephemeral \
  --skip-git-repo-check \
  --output-schema <schema.json> \
  --output-last-message <result.json> \
  -
```

The prompt is supplied on stdin.

Optional model selection:

```bash
--model <model>
```

The implementation can use:

```text
CODEX_BIN
```

or the Builder option:

```ts
{
  binary:
    "/path/to/codex"
}
```

## Structured phases

### RequirementAnalyst

Codex receives:

```text
RequirementRequest
ProjectInventory
```

and must return a strict `BusinessSpec`.

The JSON Schema prevents normal prose output from becoming Builder state.

### SolutionArchitect

Codex receives:

```text
BusinessSpec
ProjectInventory
```

and returns a strict `BuildPlan`.

Prompt constraints include:

```text
reuse existing capabilities
use npm/MCP rather than inventing package infrastructure
stable semantic IDs
advance existing durable Workflow versions
minimal file/test plan
```

### ArtifactImplementer

Codex receives:

```text
BusinessSpec
BuildPlan
```

and returns:

```text
GeneratedArtifact[]
```

The generated package is still subject to normal UAIR verification and ChangeSet/Contract analysis.

## Builder composition

```ts
const deps =
  createCodexBuilderDefaults(
    projectRoot,
    storage,
    {
      binary:
        "codex",
      model:
        "gpt-5.6-sol"
    }
  );

const builder =
  createBuilderWorkflow(
    deps
  );
```

## CLI

Codex is the default CLI Builder backend:

```bash
uair build \
  --requirement "修改请假审批规则" \
  --scope acme \
  --package @acme/leave
```

Explicit:

```bash
uair build \
  --backend codex \
  --codex-bin codex \
  --model gpt-5.6-sol \
  --requirement "..."
```

Reference/testing fallback:

```bash
uair build \
  --backend deterministic \
  --requirement "..."
```

There is no silent fallback from Codex to deterministic generation. If the Codex executable/authentication is unavailable, Codex mode fails visibly.

## Verification

v0.50 includes an executable fake-Codex process that validates the actual process protocol without pretending to be a model.

The test verifies exactly three Codex calls:

```text
1. RequirementAnalyst
2. SolutionArchitect
3. ArtifactImplementer
```

Every call must contain:

```text
codex exec
--ephemeral
--output-schema
--output-last-message
--model
```

Then the returned candidate proceeds through the real UAIR pipeline:

```text
ArtifactVerifier
ChangeSet
Contract Compatibility
Runtime Impact
Migration Plan
Deployment Plan
```

Finally the Codex-generated candidate package is materialized and TypeScript compiled.

Verified result:

```text
Codex calls:
3

Workflow:
hr.leave.request@3

Business rule:
input.days > 2

ChangeSet:
SAFE

Contract:
COMPATIBLE

Migration:
version-isolation

Deployment:
v3

Candidate TypeScript compile:
PASS
```

## Current runtime limitation of this build environment

The development container used to produce v0.50 did not expose a Codex CLI executable or Codex/OpenAI authentication state.

Therefore the repository's Codex process protocol and complete UAIR integration are verified, but this build did not claim a genuine remote model invocation.

On a machine with Codex installed and authenticated, the same backend calls the official `codex exec` process directly.

For the v0.67 macOS release-candidate validation, an authenticated official
Codex CLI invocation completed successfully in an ephemeral, read-only session.
This is transport/authentication evidence only; the three-phase Builder
protocol and candidate compilation continue to be verified by the executable
integration gate described above.

## Security boundary

Codex output is never interpreted as authorization.

The model cannot decide:

```text
release --approve
retire --approve
```

Those remain ReleaseController actions requiring explicit approval.
