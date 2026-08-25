# Deterministic execution contract

UAIR rebuilds Workflow progress by running the Workflow again and matching
durable operations against History. Determinism therefore applies to the
**durable control flow**, not to every ordinary TypeScript expression.

## The contract

For the same Workflow identity, version, input and History, Workflow code must
reach the same durable operations in the same structural order:

```text
Component ID
structural path
parallel/race branch position
Suspension position
```

UAIR fails closed with `NonDeterministicWorkflowError` when History contains a
different Component at the structural path reached during replay.

## Safe inside Workflow code

- pure computation over input and previously recorded Component results;
- local variables and ordinary TypeScript control flow derived from those values;
- calls to Components with stable IDs;
- `parallel()` and `race()` with stable branch order;
- `resume()` through the pinned Workflow version and fingerprint.

## Unsafe as durable control-flow input

Do not branch the durable operation sequence directly on:

- wall-clock time (`Date.now()`, `new Date()`);
- randomness (`Math.random()`, random UUIDs);
- environment variables or mutable process globals;
- filesystem, network, database or model responses;
- unordered collection iteration whose order can change;
- Agent memory, prompts, skills or checkpoints.

Read those values inside a Component so the result is recorded in History, then
branch on the recorded result. Time-based waiting must use a durable timer
Component/Suspension instead of a process-local sleep.

## Code evolution

Harmless refactors keep the durable ID and version. A change that can alter the
durable operation sequence for an existing Execution requires a new Workflow
version or an explicit migration. A matching version is not permission to
silently accept a different fingerprint.

UAIR detects structural mismatches; it cannot statically prove every JavaScript
program deterministic. Authors and release tooling share responsibility for
the rules above.
