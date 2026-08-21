# Soak and Fault Testing

A single passing chaos run is not production evidence.

UAIR has two complementary local soak styles.

## Load soak

```bash
npm run soak
```

Defaults to many short durable executions and can be configured with:

```text
UAIR_SOAK_EXECUTIONS
UAIR_SOAK_CONCURRENCY
```

This is mainly throughput/repetition coverage.

## Resilience soak

Smoke:

```bash
npm run test:soak-smoke
```

Longer release run:

```bash
npm run test:soak
```

The resilience runner repeatedly exercises:

```text
chaos worker crash/reclaim
queue duplicate/reorder/delay/lease faults
resolve/cancel and event/timer races
SQLite multi-connection revision races
```

Every chaos cycle uses a different deterministic seed. The base seed is
recorded so a failed run can be reproduced.

Configuration:

```text
UAIR_SOAK_CYCLES
UAIR_SOAK_SEED
UAIR_SOAK_EXECUTIONS_PER_VERSION
```

## Live release gate

With a real PostgreSQL database:

```bash
DATABASE_URL=... npm run release:live-gate
```

It runs:

```text
real PostgreSQL integration/fault harness
+
multi-seed resilience soak
```

Use:

```text
UAIR_LIVE_SOAK_CYCLES
```

to increase the release duration.

Long-running CI/overnight soak evidence should be retained with:

```text
commit SHA
Node version
OS
PostgreSQL version
base seed
cycle count
failure seed if any
```
