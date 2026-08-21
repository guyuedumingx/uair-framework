# UAIR PostgreSQL Integration Gate

This harness requires a real PostgreSQL server and the `pg` driver.

Default connection:

```text
postgres://postgres:postgres@127.0.0.1:5432/uair_test
```

Override with:

```bash
DATABASE_URL=postgres://... npm run test:postgres
```

The harness opens multiple independent database connections and verifies:

```text
concurrent queue claim uniqueness
concurrent visibility-timeout reclaim
shared worker registry visibility
atomic capacity reservation
two leaderless schedulers competing for one capacity slot
```

The repository GitHub Actions workflow:

```text
.github/workflows/postgres-integration.yml
```

starts PostgreSQL 16 and executes this harness as a v1-alpha release gate.
