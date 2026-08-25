# UAIR Production Support Profiles — v0.68

UAIR packages expose several storage/queue implementations, but they do not
have the same support level.

## Supported intent

| Adapter | Intended use | Production claim |
| --- | --- | --- |
| `JsonFileStorage` | examples, local development, inspection | **not production** |
| `InMemoryResumeQueue` | tests, single-process development | **not production** |
| `SqliteRuntimeState` | single-node / edge / embedded durable runtime | candidate production backend |
| `SqliteReliableWorkerQueue` | single-node durable queue | candidate production backend |
| `PostgresRuntimeState` | multi-process/shared durable runtime | candidate production backend; live DB gate required |
| `PostgresReliableWorkerQueue` | multi-process reliable queue | candidate production backend; live DB gate required |
| `JsonFileMcpInvocationStore` | examples and local MCP hosts | **not production** |
| `SqliteMcpInvocationStore` | single-node / embedded MCP host | candidate production backend |
| `PostgresMcpInvocationStore` | multi-process/shared MCP host | candidate production backend; live DB gate required |

This avoids solving production corruption/recovery by making the development
JSON adapter increasingly complicated.

## SQLite durability profile

`SqliteRuntimeState` configures:

```text
WAL
synchronous = FULL
foreign_keys = ON
busy_timeout
```

Multi-record execution/suspension mutations use one SQLite transaction.

v0.54 verifies real process death (`SIGKILL`) at these critical points:

```text
save execution:
  after execution upsert

save execution + create suspension index:
  after execution upsert
  after suspension index insert

save execution + remove suspension index:
  after execution upsert
  after suspension index delete
```

After each kill the database is reopened and verified for:

```text
logical rollback to pre-transaction state
execution/index consistency
PRAGMA integrity_check = ok
```

## PostgreSQL durability profile

`PostgresRuntimeState` uses:

```text
transactional combined execution/suspension writes
single-statement optimistic execution revision UPSERT
foreign-key suspension/outbox references
idempotent inbox/event-receipt/outbox inserts
```

The revision UPSERT handles both existing-row and missing-row races:

```text
INSERT ... ON CONFLICT ... DO UPDATE
WHERE current_revision = expected_revision
RETURNING revision
```

Exactly one concurrent writer may advance a given expected revision.

The GitHub/Docker PostgreSQL integration harness now includes:

```text
12-way Runtime execution revision race
combined execution + suspension atomicity
newer Runtime storage schema refusal
```

These tests require a real PostgreSQL server and are mandatory through Docker
or CI before a production release.

## Runtime storage schema compatibility

Storage schema version is separate from Workflow History schema version.

SQLite records:

```text
uair_runtime_meta.runtime_schema_version
```

PostgreSQL records:

```text
uair_runtime_meta.runtime_schema_version
```

Rules:

```text
unversioned/legacy supported storage
→ migrate forward

known current schema
→ open

schema newer than current Runtime binary
→ refuse startup
```

Refusing a newer schema is intentional. An old binary must not silently mutate
a database created by a newer Runtime.

## Backup and corruption policy

Production operators must back up the authoritative database, not transient
in-memory/index projections.

SQLite:

```text
use SQLite-aware backup/checkpoint tooling
verify PRAGMA integrity_check on restore
do not copy a live WAL database as unrelated loose files
```

PostgreSQL:

```text
use standard PostgreSQL physical/logical backup tooling
restore into a separate database
run UAIR schema/version gate before routing workers
```

UAIR must fail closed when the authoritative Runtime database cannot be
decoded/opened safely.

JSON storage has no production recovery guarantee and must not be used as a
production source of truth.

## MCP Invocation durability profile

MCP Invocation state is an outer Runtime Host concern, separate from Core
History. The SQLite and PostgreSQL stores use the same
`claimed → bound → complete` contract and keep idempotency identity scoped by
principal, tool and idempotency key. Request hashes and authenticated access
scope are immutable after the first claim.

The database gates verify:

```text
100 concurrent claims → one winner
multi-process claims → one winner
lease expiry → fenced recovery
stale lease token → rejected write
Execution ID → unique reverse lookup
different request/scope reuse → conflict
newer Invocation schema → refuse startup
```

These guarantees prevent duplicate Workflow Execution creation. They do not
replace downstream Component idempotency: external effects must still use the
stable Component `effectId` as their idempotency key.
