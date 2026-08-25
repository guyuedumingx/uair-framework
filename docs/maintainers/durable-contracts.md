# Durable Contracts

Some UAIR values outlive the current process and therefore require stricter
compatibility discipline than ordinary TypeScript APIs.

Durable contracts include:

```text
Workflow ID
Workflow version
Component ID/effect identity
Execution History schema
Runtime storage schema
Surface/Interaction payload contracts
deployment/fingerprint compatibility
durable structural path/order
Component effect generation and effectId
```

## Refactoring

These should not change durable identity:

```text
rename variable
move source file
change folder
change bundler
rename private helper
format source
```

## Version changes

Do not bump Workflow version for cosmetic refactors.

Do bump/change durable version when a running old Execution and a newly deployed
implementation cannot safely share the same replay semantics.

## Schema rules

```text
N-1 → N
migrate if supported

N
read/write normally

N+1
older Runtime fails closed
```

Never silently accept an unknown newer durable schema.

## Compatibility review

Any PR that changes a durable contract must include:

```text
migration/change-set impact
old suspended Execution behavior
rollback behavior
release/drain strategy
tests
```

Normative execution rules live in:

```text
docs/architecture/deterministic-execution.md
docs/architecture/delivery-and-idempotency.md
```
