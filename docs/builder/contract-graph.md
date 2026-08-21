# UAIR Contract Graph — v0.46

`ProjectGraph` answers:

```text
what exists?
who uses whom?
```

`Contract Graph` adds:

```text
what data crosses each boundary?
will old callers / old durable payloads still work?
```

The contract layer lives in `@uair/builder`. Runtime Core remains unchanged.

## Source of truth

UAIR does not introduce another schema language.

Builder projects normal TypeScript types into an analysis-only `ContractShape`:

```text
unknown
primitive
literal
array
union
object
```

For a Component:

```ts
const customer =
  component({
    id:
      "crm.customer.load",

    async run(input: {
      id: string;
    }) {
      return {
        name: "Star",
        tier: "A"
      };
    }
  });
```

Builder derives:

```text
component:crm.customer.load

input
  id: string (required)

output
  name: string (required)
  tier: string (required)
```

No developer-authored UAIR schema is required.

## Surface contract

For:

```ts
await surface<
  ApprovalData,
  ApprovalValue
>({
  kind:
    "hr.leave.manager-approval",
  data: {
    employeeId,
    days
  }
});
```

Builder records:

```text
surface:hr.leave.manager-approval

data
  employeeId: string
  days: number

action
  type: string
  value?: ApprovalValue
  id?: string
  label?: string
```

Explicit `surface<Data, Value>` generics provide the strongest action contract evidence.

Without an explicit action generic, action compatibility is treated as unknown rather than guessed.

## Compatibility direction

Input-like contracts must continue accepting values accepted by the previous version.

Breaking example:

```text
before input
  id: string

after input
  id: string
  region: string   ← new required field
```

Error:

```text
INPUT_CONTRACT_NARROWED
```

Adding an optional input field is compatible.

Output-like contracts must continue providing what existing consumers could rely on.

Breaking example:

```text
before output
  name: string
  tier: string

after output
  name: string
```

Error:

```text
OUTPUT_CONTRACT_BROKEN
```

Surface data is treated as durable input to the renderer/continuation boundary.

Breaking example:

```text
before
  employeeId
  days

after
  employeeId
  days
  departmentId   ← required
```

Error:

```text
SURFACE_DATA_CONTRACT_NARROWED
```

Surface action narrowing is also detected:

```text
before action value
  approved: boolean

after action value
  approved: boolean
  comment: string   ← required
```

Error:

```text
SURFACE_ACTION_CONTRACT_NARROWED
```

## Durable payload compatibility

Source-to-source compatibility is not enough for long-running software.

A Workflow may already be suspended with durable data such as:

```json
{
  "kind": "hr.leave.manager-approval",
  "data": {
    "employeeId": "E1001",
    "days": 2
  }
}
```

Builder scans unresolved durable Suspensions and validates those payloads against the candidate Surface data contract.

If the new contract requires:

```text
departmentId
```

the release is blocked with:

```text
PENDING_SURFACE_PAYLOAD_INCOMPATIBLE
```

This answers the practical question:

> Can the new code/UI still consume what is already persisted in production?

## Release gate

Project-aware Builder now evaluates:

```text
current ProjectGraph
candidate ProjectGraph
↓
ChangeSet
↓
ChangeSet Safety
↓
Contract Compatibility
↓
Runtime Impact
↓
Release Proposal
```

A candidate is blocked before Release Proposal creation if:

```text
ChangeSet safety = false
OR
Contract compatibility = false
```

The Release Proposal includes evidence:

```text
changeSet
changeSafety
contractCompatibility
impact
```

## Current limitations

v0.46 intentionally remains conservative.

It does not yet fully model:

```text
database schema migrations
JSON Schema / protobuf compatibility
generic conditional/mapped TypeScript types in all cases
runtime validation libraries such as Zod as first-class contract sources
semantic meaning changes with identical shapes
cross-language contracts
```

Those can be added as Builder analyzers or adapters without changing Runtime Core.
