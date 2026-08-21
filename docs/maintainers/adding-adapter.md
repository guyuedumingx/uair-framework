# Adding an Adapter

Adapters connect UAIR to external systems without transferring ownership of
those systems into Runtime Core.

Examples:

```text
Agent framework
MCP
database
queue
IAM
notification channel
observability exporter
```

## Rules

- keep provider-specific state provider-owned;
- translate only the UAIR-facing boundary;
- fail closed on security-sensitive defaults;
- expose a narrow public package API;
- add the public exports to the adapter compatibility snapshot;
- add provider-independent semantic tests;
- add live integration tests when the external environment is available.

For Agent adapters, do not copy framework memory/checkpoints/skills into UAIR
History by default.

For MCP/network adapters, validate the target before connecting.

For notification adapters, durable Interaction remains the source of truth;
delivery success is not task existence.
