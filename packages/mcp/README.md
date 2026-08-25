# @uair/mcp

MCP client and server adapters for the UAIR MCP-first Multi-Runtime model.

**Status:** alpha MCP adapter with stdio and Streamable HTTP support

## Install

```bash
npm install @uair/mcp
```

## Compatibility

This package follows the UAIR alpha compatibility policy. Runtime Core has the
strongest compatibility target; Builder, sandbox, deployment and experimental
tooling interfaces may still evolve before 1.0.

Do not depend on undocumented `src/`, `internal/`, or physical storage/history
implementation details.

Server-side public APIs include `publishWorkflow()`,
`createMcpRuntimeHost()`, `createMcpRuntimeServer()` and the Invocation stores.
Client-side APIs include stdio/HTTP connectors and
`createMcpCapabilitySet()` for stable source-qualified tools.

The supported baseline is MCP SDK 2.0.0. Its current server runtime does not
offer negotiated Tasks handlers; UAIR keeps the MCP Tasks fallback of opaque
Execution handles and three fallback tools. It does not silently serve the
legacy 2025-11-25 Tasks wire vocabulary.

Remote authentication belongs before MCP dispatch. A production remote
Runtime must be an OAuth protected resource and must derive its Principal from
validated request context, never from Workflow arguments.

Workflow starts are claimed atomically before execution. The Invocation store
binds the resulting Execution to an access scope and rejects reuse of one
idempotency key with different input. Client adapters derive the reserved
`io.uair/idempotency-key` metadata from the UAIR Component `effectId`; custom
`callMeta` may add authentication or tracing metadata but cannot override that
reserved key.

By default, authenticated principals with a `tenantId` share only that tenant
scope; principals without one are isolated by principal ID. Hosts that need a
different authenticated realm boundary may provide `accessScopeKey`, but it
must be derived from validated request context rather than Workflow arguments.
The three `uair.execution.*` / `uair.interaction.resolve` fallback names are
reserved and cannot be published as application Workflow tool names.

Published Workflow input schemas are enforced by the Runtime Host before an
Execution is created. `JsonFileMcpInvocationStore` uses leases, atomic record
replacement and crash-recoverable locks for local/reference hosts. Production
HTTP hosts should provide a transactional Invocation store backed by their
database.

The claim prevents duplicate Execution creation; it does not promise universal
exactly-once external effects. After a crash, resumed Components reuse their
stable `effectId`, which the downstream system must deduplicate or otherwise
handle idempotently.

### Pre-release record compatibility

The reliability gate replaces the unmerged prototype Invocation record with a
claimed/bound/complete state machine. Invocation files created by an earlier
v0.68 development snapshot fail closed instead of being guessed or silently
migrated. This does not change UAIR Execution History. Before deploying this
unreleased change, drain or explicitly migrate any prototype Invocation
directory; rollback must use the matching host and Invocation-store version.

## Documentation

See `docs/guides/multi-runtime-agent.md`, the repository root README and
`docs/` directory for the current
architecture, guides, compatibility policy, and release status.

## License

MIT.
