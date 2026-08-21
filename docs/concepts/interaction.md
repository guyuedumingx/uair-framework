# UAIR Interaction — v0.51

UAIR does **not** require every employee to run a local Runtime.

For fixed enterprise software, the normal topology is:

```text
Employee Web/App/WeCom
        ↓
Company Gateway
        ↓
Central UAIR Runtime + Storage
        ↓
Workflow
        ↓
durable Interaction
        ↓
Manager Inbox / notification adapter
        ↓
resolve
        ↓
Workflow resumes
```

The end user sees the company's OA/App, not "UAIR".

## Minimal-core decision

v0.51 deliberately does **not** add these concepts to Runtime Core:

```text
User
Role
Department
Organization
Channel
Notification
Approval
Task database
```

Core already had the necessary primitive:

```text
Suspension
```

A human Interaction is therefore only a typed Suspension:

```ts
{
  type:
    "interaction",
  assignee:
    "user:manager-li",
  kind:
    "hr.leave.manager-approval",
  data: {
    ...
  }
}
```

The new `@uair/interaction` package is an outer convenience/policy layer.

Core remains unaware of enterprise identity and UI channels.

## API

```ts
const managerApproval =
  interaction<
    ApprovalPayload,
    ApprovalResult
  >(
    "hr.leave.manager-approval"
  );

const decision =
  await managerApproval({
    assignee:
      managerId,
    data: {
      request
    }
  });
```

This suspends the Workflow using the existing Core mechanism.

## Inbox

```ts
const service =
  new InteractionService(
    storage
  );

const pending =
  await service.listPending(
    "user:manager-li"
  );
```

The Inbox is a **projection of unresolved suspensions**.

There is no second durable interaction state machine.

That avoids these duplicate truths:

```text
Suspension says pending
Interaction table says resolved

or

Suspension says resolved
Task table says pending
```

## Authorization

Reading and resolving are server-side authorized.

Default policy:

```text
actor === assignee
```

A host may inject enterprise policy:

```ts
new InteractionService(
  storage,
  ({
    actor,
    assignee
  }) =>
    actor === assignee ||
    isValidDelegate(
      actor,
      assignee
    )
);
```

This supports:

```text
delegation
acting manager
role/group policy
temporary authorization
```

without teaching Core what those concepts mean.

Direct object lookup also uses the same authorization; knowing a suspension ID is not sufficient to read its data.

## Organization lookup is a Component

Do not do this inside a durable Workflow:

```ts
const manager =
  await hrApi.managerOf(
    employeeId
  );
```

if it is an uncontrolled external call.

Use a normal UAIR Component/capability:

```ts
const managerOf =
  component(
    "org.managerOf",
    {
      resultValidForMs:
        5 * 60 * 1000
    },
    async input =>
      hrApi.managerOf(
        input.employeeId
      )
  );
```

This makes the organization lookup part of durable execution semantics.

When a pending Interaction is created, its assignee is a snapshot:

```text
user:manager-li
```

A later org-chart change does not silently rewrite the already-created approval.

Whether a stale lookup should refresh on a future replay is controlled by normal Component TTL/business policy.

## Audit identity

Core `SuspensionResolved` now has one optional generic field:

```ts
resolvedBy?: string
```

`InteractionService` writes the actor identity here.

Core does not interpret the identity.

Example durable history:

```text
suspension_created
  assignee = user:manager-li

suspension_resolved
  resolvedBy = user:assistant-chen
```

This preserves the difference between:

```text
assigned to
```

and:

```text
actually acted by
```

which is required for delegated approval audit.

## Duplicate/concurrent clicks

Approval clients naturally retry:

```text
mobile click
desktop click
HTTP retry
gateway retry
```

Sequential duplicates are recovered from durable History after the suspension index is removed.

Concurrent resolutions use the Execution revision as an optimistic concurrency fence.

The first durable resolution wins.

A later concurrent writer reloads the winner instead of overwriting it.

This is generic suspension correctness, not approval-specific logic.

## Expiration

Expired Interactions are not returned as actionable Inbox items and cannot be resolved by `InteractionService`.

UAIR does not add a separate "approval timeout engine".

Use existing Workflow primitives when timeout/escalation changes control flow:

```text
race(
  manager interaction,
  timer
)
```

Then the Workflow can:

```text
timeout
→ cancel old interaction
→ resolve a new assignee
→ create a new interaction
```

## Notifications and channels

`Interaction` is the source of truth.

Notification is only delivery.

```text
pending Interaction
      ↓
host adapter
├─ WebSocket
├─ App Push
├─ WeCom
├─ DingTalk
├─ Teams
└─ Email
```

No `Channel` type was added to Core.

A failed WeCom notification must not make the approval disappear; the manager can still see the durable Inbox.

Notification retry/deduplication belongs to the host/adapter layer.

## Multi-person approvals

No new approval DSL is required.

Use existing Workflow composition:

```text
all must approve
→ parallel(interactionA, interactionB)

first valid responder
→ race(interactionA, interactionB)

sequential approval
→ await interactionA
  then await interactionB
```

Business packages may wrap these patterns ergonomically, but Core does not need `ApprovalNode`, `Quorum`, etc.

## Employee "My Requests"

This is different from Inbox.

```text
Inbox
→ work I must act on

My Requests
→ business cases I initiated
```

UAIR intentionally does not add `owner`/`employee` identity to generic Execution Core.

A company application can project:

```text
business request ID
employee ID
execution ID
status
```

into its own query model/database.

This avoids turning Runtime storage into an enterprise application database.

## Tenant isolation

Multi-company SaaS tenancy remains a host concern:

```text
Tenant Gateway
Tenant-aware auth
Tenant storage namespace/database
Tenant package/deployment policy
```

Core IDs should never be treated as authorization.

The host must establish tenant + actor before querying an Inbox or execution.

## Builder visibility

Builder ProjectGraph now understands:

```ts
interaction<
  Payload,
  Result
>(
  "hr.leave.manager-approval"
)
```

as the existing `surface` contract concept.

This is intentional reuse rather than a new graph node kind.

Builder sees:

```text
workflow:oa.leave.interactive
  uses
surface:hr.leave.manager-approval
```

and Contract Graph derives:

```text
data contract
action/result contract
```

so changes to human approval payloads remain compatibility-analyzed.

## Centralized HTTP demo

`examples/interaction-oa-server` demonstrates a real deployment shape:

```text
POST /api/leave
GET  /api/inbox?actor=user:manager-li
POST /api/interactions/:id/resolve
GET  /api/executions/:id
```

One central Runtime serves employee and manager clients.

The demo was exercised end-to-end:

```text
employee submit
→ manager Inbox = 1
→ manager approve
→ director Inbox = 1
→ director approve
→ same Execution completed
```

## What remains outside Core

After attacking the real scenario, these are important but still **not Core primitives**:

```text
SSO/session authentication
organization directory
delegation policy
tenant isolation
notification delivery
Web/App/WeCom renderer
"My Requests" query model
SLA/escalation policy
business audit/reporting
```

They should be packages/adapters/application services.

This boundary is the main v0.51 design result.
