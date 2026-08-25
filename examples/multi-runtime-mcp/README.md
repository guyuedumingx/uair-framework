# One Agent, two UAIR Runtimes

This reference connects one Agent client to a personal UAIR Runtime over MCP
stdio and a company UAIR Runtime over MCP Streamable HTTP. Each Runtime owns
its own durable Storage and authorization policy; the Agent persists only
opaque Execution handles.

The bearer token used by the test harness is deliberately test-only. A real
company deployment must authenticate Streamable HTTP with MCP OAuth/OIDC
middleware before `resolvePrincipal`; bearer credentials must never enter
Workflow input, Component calls, History or Agent state.
