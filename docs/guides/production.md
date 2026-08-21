# Production Deployment

Recommended shape:

```text
Gateway/Auth
    ↓
UAIR Runtime workers
    ↓
PostgreSQL Runtime state / reliable queue
    ↓
existing APIs, MCP, Agents, business systems
```

Optional production packages include:

```text
@uair/security
@uair/ops
@uair/otel
@uair/interaction
```

Before production claims, verify:

- real PostgreSQL concurrency/atomicity;
- rolling upgrade behavior;
- secret manager and tenant boundary;
- network/MCP sandbox enforcement;
- package provenance;
- backup/restore;
- health/readiness/drain;
- dead-letter recovery;
- provider-specific Agent integrations.

See `../operations/production-readiness.md`,
`../operations/production-profiles.md`, and
`../release/mac-validation.md`.
