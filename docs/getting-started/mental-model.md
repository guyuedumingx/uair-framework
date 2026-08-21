# Mental Model

Think of UAIR as a durable execution layer, not an application framework that
owns every concern.

```text
Your application/domain
        ↓
optional UAIR packages/adapters
        ↓
Runtime adapters
        ↓
UAIR Core
```

Use this decision tree:

```text
Is this ordinary in-process computation?
→ normal TypeScript function

Does this operation touch an external system and need replay/idempotency?
→ Component

Can this process span time, crashes, deploys or human interaction?
→ Workflow

Does an external actor/system need to answer later?
→ Interaction/Suspension

Is this auth, tenant, secret, MCP, Agent, UI or observability?
→ optional outer package/host concern

Is this approval/OA/commerce/assets/risk?
→ domain package, not Core
```

UAIR should not become:

```text
IAM
OA
BPM low-code
Agent framework
database
frontend framework
package registry
secret manager
```

It should compose with those systems.
