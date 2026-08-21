# Architecture

## Kernel

```text
Workflow
Component
Effect
Suspension
Scope
History
```

No ecosystem-specific primitive belongs in the kernel unless at least two materially different integrations cannot map onto existing primitives without semantic loss.

## Fixed vs dynamic control

```text
Workflow
  deterministic governance boundary

Agent
  bounded dynamic decision boundary
```

Enterprise controls such as approval, audit and persistence should remain outside an Agent when they must be mandatory.

## Capability lifecycle

```text
Discover
Authorize
Acquire
Execute
```

These phases must remain distinct.

```text
discoverable != authorized
authorized != installed
installed != executable
executable != Agent-visible
```

## Package model

npm remains the distribution and dependency system.

Preinstalled trusted packages may expose:

```text
./uair ESM export
```

Dynamically acquired third-party packages should prefer static metadata plus sandbox-proxy execution so host Runtime does not import acquired code directly.

## Durable truth

```text
Execution History
= durable truth

indexes / queues / outbox
= projections or delivery mechanisms
```

Anything required for crash recovery must be durable before dispatch.
