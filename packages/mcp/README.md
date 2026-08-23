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

## Documentation

See `docs/guides/multi-runtime-agent.md`, the repository root README and
`docs/` directory for the current
architecture, guides, compatibility policy, and release status.

## License

MIT.
