# Adding a Storage Adapter

A Storage implementation is part of durable correctness.

It must preserve:

```text
Execution revision fencing
Execution + Suspension atomic mutations
idempotent durable writes
future-schema fail-closed behavior
crash recovery
list/find consistency
```

## Required tests

At minimum:

```text
concurrent same-revision writers → one durable winner
create/remove Suspension atomicity
process/transaction crash points
N-1/N/N+1 schema compatibility
restart/reopen recovery
```

Shared multi-process stores also require real database concurrency tests.

Do not claim a development adapter is production-safe merely because it
implements the TypeScript interface.
