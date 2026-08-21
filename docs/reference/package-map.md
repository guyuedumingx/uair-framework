# Package Map

| Package | Layer | Needed by everyone? | Purpose |
| --- | --- | --- | --- |
| `@uair/core` | Core | Yes | Durable Workflow/Component/History/runtime contracts |
| `@uair/sqlite` | Runtime adapter | No | Single-node/embedded durable backend |
| `@uair/postgres` | Runtime adapter | No | Shared production-oriented durable backend |
| `@uair/ui` | Platform | No | UI/surface suspension helpers |
| `@uair/interaction` | Platform | No | Durable external interaction/inbox semantics |
| `@uair/agent` | Platform | No | Existing Agent framework boundary |
| `@uair/mcp` | Platform | No | MCP adapter |
| `@uair/package` | Platform | No | Package/capability contracts |
| `@uair/security` | Platform | No | Host security policy helpers |
| `@uair/sandbox` | Platform | No | Sandboxed acquisition/execution |
| `@uair/otel` | Platform | No | Observability projection |
| `@uair/ops` | Platform | No | Health, drain, errors, metrics, recovery |
| `@uair/builder` | Tooling | No | Project-aware AI/deterministic builder |
| `@uair/forge` | Tooling | No | Capability/package generation |
| `@uair/cli` | Tooling | No | CLI surface |
| `@uair/oa` | Domain/reference | No | OA/approval reference implementation |

The package list is intentionally larger than the Core mental model. Most
applications should install only the layers they need.
