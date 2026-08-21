# Architecture Boundaries

UAIR accepts new Core concepts only when they are necessary for generic durable
execution correctness.

## Core admission test

Before adding a public Core primitive, answer all of these:

1. Is it required for durable execution correctness?
2. Does it apply naturally across unrelated domains?
3. Can existing primitives not express it safely?
4. Is it independent of UI, Agent framework, IAM, organization model, cloud,
   database vendor and business domain?
5. Would leaving it outside Core cause correctness failure rather than merely
   less convenient syntax?

If any answer is no, prefer an outer package, adapter or host policy.

## Examples that do not belong in Core

```text
User
Role
Tenant
Department
Approval
Order
Asset
Risk
Notification
MCP
Agent memory
Skill
React component
Secret manager
```

## Removal test

If removing the package still leaves UAIR as a durable execution runtime, the
package is not Core.

Approval/OA currently lives in `@uair/oa` as a domain/reference package.
