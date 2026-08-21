# Builder Bootstrap Boundary

UAIR can already bootstrap a business **candidate** from a minimal
`create-uair` project.

Verified flow:

```text
create-uair
→ minimal @uair/core app
→ Builder inspects project
→ requirement analysis
→ architecture plan
→ Reuse / Install / Generate resolution
→ candidate package/workflow/surfaces/tests
→ verification/governance
→ release proposal
```

This is real self-extension of the project model.

## What "self-bootstrapping" means today

The current Builder can start with almost no business structure and create the
first fixed-business package.

It can also inspect an existing UAIR system on later runs and prefer:

```text
Reuse
→ Install
→ Generate
```

instead of blindly recreating capabilities.

## What is not yet automatic

The following is deliberately **not** one autonomous loop today:

```text
one vague goal
→ repeatedly invent requirements
→ silently promote generated source
→ silently install packages
→ silently publish/deploy
→ continue forever until "complete"
```

There are two reasons.

### Candidate promotion is explicit

`uair build` writes a verified candidate/proposal.

It does not silently overwrite the current source tree. The candidate must move
through the release/change path.

This prevents an AI iteration from destroying the currently working project.

### Authority boundaries remain explicit

Package acquisition and production release require independent authorization
and security policy.

The Builder cannot approve its own package trust or production deployment.

## Current user flow

From a generated project, an AI-capable development host can run:

```bash
npx @uair/cli build \
  --backend codex \
  --requirement "..."
```

Then:

```text
review proposal
approve required extension acquisition
promote/release candidate
run the next requirement
```

A coding Agent can automate the development-side repetitions while still
stopping at configured authority gates.

## Missing convenience layer

For a true "give one product goal and let the system continuously elaborate
it" experience, UAIR would still need a thin outer goal/orchestration loop that
can:

```text
maintain product backlog
select next requirement
run Builder
evaluate acceptance criteria
promote accepted candidate into the working project
re-inspect the new project
repeat
stop at human/security/release gates
```

That is an outer development Agent/product loop, not a new Runtime Core
primitive.

It should not be added merely to claim autonomy before real usage establishes
the right workflow.
