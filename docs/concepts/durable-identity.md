# Stable Identity Guide

UAIR durable execution needs stable identity, but application code should
declare that identity only once.

## The shortest normal Workflow

```ts
const checkout =
  workflow(
    "commerce.checkout",
    async input => {
      // ordinary TypeScript
      return result;
    }
  );
```

This creates:

```text
id      = commerce.checkout
version = 1
```

So the initial/default version does **not** need to be written.

## When to write `version`

Write it when the Workflow has a durable evolution boundary:

```ts
const checkout =
  workflow(
    "commerce.checkout",
    {
      version:
        "2"
    },
    async input => {
      ...
    }
  );
```

A long-running execution may be suspended while a newer deployment is
released. UAIR therefore needs a stable version to decide which implementation
may safely resume that execution.

For a small local program with no old durable executions, implicit `"1"` is
usually enough.

For a reusable package or production Workflow, treat version changes as part
of release/migration discipline.

## Why `id` is different

A durable ID answers:

> What logical operation is this History entry / suspended execution referring
> to after code has moved, been bundled, renamed or redeployed?

Do **not** derive durable identity from:

```text
variable name
function.name
file name/path
line number
class name
bundler chunk
hash of current source alone
```

These change during harmless refactors.

Therefore a durable Workflow/Component identity is semantic protocol data, not
ordinary implementation metadata.

## Ordinary functions need no ID

UAIR does not require every function to become a Component.

```ts
function calculateTotal(
  items
) {
  ...
}
```

No UAIR ID is needed.

Use a `component()` only when you need UAIR durable effect semantics around the
boundary:

```ts
const charge =
  component(
    "payments.charge",
    async input =>
      paymentApi.charge(
        input
      )
  );
```

So the rule is:

```text
ordinary in-process computation
→ normal TypeScript function

durable/replayable external boundary
→ Component with stable ID

long-running durable orchestration
→ Workflow with stable ID
```

This avoids turning ordinary source code into a configuration graph.

## Object form remains available

For public/reusable definitions with more metadata:

```ts
export const approveOrder =
  workflow({
    id:
      "order.approve",
    version:
      "3",

    async run(
      input
    ) {
      ...
    }
  });
```

The compact and object forms have the same runtime semantics.

## IDs should be explicit once, then referenced as objects

Good:

```ts
export const checkout =
  workflow(
    "commerce.checkout",
    ...
  );

new RuntimeEngine(
  storage,
  [
    checkout
  ]
);
```

Avoid repeating:

```ts
{
  "commerce.checkout":
    checkout
}
```

UAIR registries accept the Workflow object directly.

## Components

```ts
const charge =
  component(
    "payments.charge",
    async input => {
      ...
    }
  );
```

The ID is needed because Component effect history may outlive the current
process.

Pure helper functions inside `charge` need no identity.

## Capability IDs

Capability IDs stay explicit because they are public capability contracts:

```ts
capability({
  id:
    "pdf.extract.tables",
  ...
});
```

Do not couple a public Capability identity automatically to one implementation
function.

## Refactoring rule

These should not change a durable ID:

```text
rename variable
move file
change folder
change bundler
change private helper function name
```

A deliberate ID change is an identity migration.

## Design rule

> Stable identity is mandatory in semantics, minimal in syntax.

UAIR should never trade durable correctness for an automatically inferred ID,
but it should also never make developers repeat durable identity throughout
the codebase.


## ID format

UAIR does not impose a domain naming DSL.

All of these can be valid stable IDs:

```text
checkout
commerce.checkout
company.commerce.checkout
```

For shared/large systems, dotted semantic names are recommended because they
are readable and work well with package/domain ownership:

```text
commerce.checkout
payment.charge
inventory.reserve
```

The Runtime only requires that the ID is:

```text
non-empty
stable across harmless refactors
free of control characters
free of leading/trailing whitespace
```

Do not encode volatile deployment data into the ID:

```text
bad:
checkout-v2026-08-21
checkout-worker-3
src-order-workflows-checkout

good:
commerce.checkout
```

A package may adopt its own namespace convention through governance tooling,
but Core deliberately does not make that convention mandatory.
