# Core Concepts

UAIR Core has a deliberately small vocabulary.

## Workflow

A long-running durable orchestration.

```ts
const checkout =
  workflow(
    "commerce.checkout",
    async input => {
      ...
    }
  );
```

A stable semantic ID is required. Initial version defaults to `"1"`.

## Component

A durable/replay-aware external-operation boundary.

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

Do not convert pure helper functions into Components.

## Execution

One durable running instance of a Workflow.

## History

The durable record used to resume/replay execution safely.

## Suspension

A generic wait for the external world.

Examples:

```text
human input
webhook
timer
authorization
external system response
```

Approval is not a Core primitive. It is one business use of generic
interaction/suspension semantics.

## Storage

Core depends on a Storage contract. Concrete adapters such as SQLite and
PostgreSQL live outside Core.

## Versioning

Workflow version is a durable evolution boundary. Version `"1"` is implicit
until a later version is needed.
