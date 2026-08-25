# UAIR

**Universal AI Runtime** — durable TypeScript workflows for AI-native applications.

Current release candidate:

```text
v0.68
```

UAIR is not another “Agent loop” framework. It provides a small durable runtime
for business processes that may span:

```text
AI
people
UI
external APIs
timers
events
packages
deployments
```

while ordinary computation stays ordinary TypeScript.

## Install

Create a minimal project:

```bash
npm create uair@latest my-app
cd my-app
npm install
npm run dev
```

Or install Core directly:

```bash
npm install @uair/core
```

## The mental model

```text
ordinary computation
→ normal TypeScript function

durable/replay-aware external work
→ Component

long-running business process
→ Workflow

waiting for the outside world
→ Suspension through UI / Interaction / event adapters
```

A normal Workflow stays code-first:

```ts
import {
  component,
  workflow
} from "@uair/core";

const charge =
  component(
    "payments.charge",
    async order =>
      paymentProvider.charge(
        order
      )
  );

export const checkout =
  workflow(
    "commerce.checkout",
    async order => {
      await charge(
        order
      );

      return {
        completed: true
      };
    }
  );
```

A stable ID is required because durable History can outlive filenames,
variables and deployments.

Initial Workflow version defaults to:

```text
"1"
```

so normal first-version code does not write it.

See `docs/concepts/durable-identity.md`.

## Why durable execution

The difficult cases are not the happy path.

```text
a worker crashes after an external side effect
an approval arrives three days later
a message is delivered twice
two schedulers race
new code is deployed while old executions are suspended
an Agent forgets a standing business obligation
```

UAIR keeps correctness outside the model by persisting execution state,
History, Suspension state and version identity.

## Blocking and non-blocking UI

Install:

```bash
npm install @uair/ui
```

Blocking:

```ts
import {
  surface
} from "@uair/ui";

const action =
  await surface({
    kind:
      "crm.customer.list",
    data: {
      items
    }
  });
```

This creates a durable Suspension.

Non-blocking:

```ts
import {
  present
} from "@uair/ui";

present({
  kind:
    "agent.progress",
  data: {
    message:
      "CRM query completed"
  }
});
```

Showing UI does not automatically change Workflow control flow.

Preferred UI API:

```text
surface()
input()
choose()
present()
```

The older `ui()` / `displayUi()` functions remain only for v0.x compatibility.

## Runnable examples

Reference applications and the OA domain proof are maintained in
`guyuedumingx/uair-examples`. This keeps examples free to evolve without making
their product concepts part of Runtime Core.

## AI Builder (companion project)

`@uair/builder` and the governance CLI are maintained in
`guyuedumingx/uair-builder`. They analyze UAIR projects while depending only on
the runtime's public contracts.

```text
natural-language requirement
→ ProjectGraph
→ reuse existing capability?
→ install an approved package?
→ generate only if still missing
→ candidate package
→ compile/tests
→ architecture governance
→ contract compatibility
→ impact analysis
→ migration/deployment proposal
→ explicit release authorization
```

The key self-extension rule is:

```text
Reuse
→ Install
→ Generate
```

AI may propose changes, but installation and release remain separately
authorized.

## Package ecosystem

UAIR uses normal npm packages rather than inventing another package manager.

Create:

```bash
uair package create @acme/risk-kit
```

Verify and pack:

```bash
uair package verify --dir risk-kit
uair package pack --dir risk-kit
```

Publish:

```bash
uair package publish \
  --dir risk-kit \
  --approve \
  --npm-publish
```

Install / upgrade / rollback:

```bash
uair package install @acme/risk-kit 1.0.0 --approve
uair package upgrade @acme/risk-kit 1.1.0 --approve
uair package rollback @acme/risk-kit --approve
```

AI Builder consumes the same package/capability model as human developers. Its
commands live in the companion `uair-builder` repository.

See:

```text
docs/guides/package-development.md
docs/guides/package-lifecycle.md
```

## Architecture governance

Large projects can use:

```bash
uair lint
uair impact payment.charge
uair graph --output architecture.mmd
```

Hard structural errors include:

```text
duplicate durable IDs
package dependency cycles
Workflow dependency cycles
cross-package private imports
```

Architecture smells remain warnings rather than new Runtime rules.

The principle is:

> Workflow owns a process; Package owns a domain.

See `docs/architecture/governance.md`.

## Package boundaries

Typical enterprise project:

```text
apps/
├─ web/
├─ admin/
└─ workers/

packages/
├─ commerce/
│  ├─ order/
│  ├─ payment/
│  └─ inventory/
├─ customer/
├─ finance/
└─ logistics/

platform/
├─ security/
├─ observability/
└─ deployment/
```

Start with a modular monolith unless independent deployment is actually needed.

## Agent compatibility

UAIR does not replace an Agent framework's:

```text
memory
context/checkpoint state
skills
model/tool policy
```

Integration can work in both directions:

```text
UAIR Workflow → existing Agent

existing Agent → UAIR Workflow
```

UAIR persists only the durable business/process facts it owns.

See `docs/agent/boundaries.md`.

## Public API layers

### Application API

Normal application code:

```text
@uair/core
@uair/ui
@uair/agent
@uair/interaction
@uair/package
```

### Runtime adapter API

Advanced hosts/adapters:

```text
@uair/core/adapter
@uair/core/runtime
```

### Cluster API

Experimental distributed scheduling:

```text
@uair/core/cluster
```

### Internal API

No compatibility promise:

```text
@uair/core/internal
```

Ordinary application code should not import the internal layer.

See `docs/release/v1-alpha-api.md`.

## Core stays small

UAIR Core intentionally does not define domain concepts such as:

```text
Approval
Employee
Order
Tenant
Role
Asset
Device
Skill
Memory
```

Those belong to packages, applications or adapters.

Core remains centered on:

```text
Workflow
Component
Execution
History
Suspension
Storage
```

## Production status

The current source is an alpha release candidate, not a production-grade 1.0
claim.

Local deterministic gates cover:

```text
durable replay
race/fault behavior
version compatibility
architecture governance
package lifecycle
AI Builder self-extension
interactive Agent behavior
release/deployment control logic
```

Real-environment evidence such as live PostgreSQL, long soak, mixed-binary
rolling upgrade and real registry provenance remains intentionally deferred to
the final validation stage.

Current status:

```text
docs/release/status.md
```

## Validate the repository

Clean local gate:

```bash
npm run release:check
```

Real-environment gate later:

```bash
DATABASE_URL=... npm run release:live-gate
```

## Documentation

Start here:

```text
docs/README.md
```

New users:

```text
docs/getting-started/quick-start.md
docs/getting-started/mental-model.md
docs/getting-started/core-concepts.md
```

Maintainers:

```text
CONTRIBUTING.md
AGENTS.md
AI_AUTHORING_GUIDE.md
```

## License

MIT.
