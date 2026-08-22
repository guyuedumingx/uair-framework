# Package Map

| Package | Layer | Needed by everyone? | Purpose |
| --- | --- | --- | --- |
| `@uair/core` | Core | Yes | Durable Workflow/Component/History/runtime contracts |
| `@uair/sqlite` | Runtime adapter | No | Single-node/embedded durable backend |
| `@uair/postgres` | Runtime adapter | No | Shared production-oriented durable backend |
| `@uair/ui` | Platform | No | UI/surface suspension helpers |
| `@uair/interaction` | Platform | No | Durable external interaction/inbox semantics |
| `@uair/agent` | Platform | No | Existing Agent framework boundary |
| `@uair/capability` | Platform contract | No | Provider-neutral capability declarations |
| `@uair/mcp` | Platform | No | MCP adapter |
| `@uair/package` | Platform | No | Package/capability contracts |
| `@uair/security` | Platform | No | Host security policy helpers |
| `@uair/sandbox` | Platform | No | Sandboxed acquisition/execution |
| `@uair/otel` | Platform | No | Observability projection |
| `@uair/ops` | Platform | No | Health, drain, errors, metrics, recovery |
| `@uair/builder`, `@uair/forge`, `@uair/cli` | Companion tooling | No | Maintained in `guyuedumingx/uair-builder` |
| Provider bridges | Companion integrations | No | Maintained in `guyuedumingx/uair-integrations` |
| `@uair/oa` and examples | Companion references | No | Maintained in `guyuedumingx/uair-examples` |

The package list is intentionally larger than the Core mental model. Most
applications should install only the layers they need.
