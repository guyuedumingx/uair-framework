# Enterprise Project Organization

For a large UAIR system, prefer package/domain boundaries over one global
`workflows/` directory.

Recommended starting point:

```text
company-platform/
├─ apps/
│  ├─ web/
│  ├─ admin/
│  └─ workers/
│
├─ packages/
│  ├─ commerce/
│  │  ├─ order/
│  │  ├─ payment/
│  │  └─ inventory/
│  ├─ customer/
│  ├─ logistics/
│  └─ finance/
│
└─ platform/
   ├─ security/
   ├─ observability/
   └─ deployment/
```

A domain package can contain:

```text
src/
├─ workflows/
├─ components/
├─ policies/
├─ types/
├─ internal/
└─ index.ts
```

## Ownership model

A useful team split is:

```text
Platform Team
→ Runtime/storage/deployment/adapters

Domain Teams
→ domain packages and durable business processes

AI/Agent Team
→ Agent adapters, evals and intelligent capabilities

Frontend/Product Teams
→ Surface/UI implementations
```

Teams collaborate through package public contracts rather than importing each
other's private `src/internal` code.

## Workflow rule

> Workflow owns a process; Package owns a domain.

Do not split a Workflow merely because a function became long.

Create a child/independent Workflow only when the sub-process has its own:

```text
durable lifecycle
failure/recovery semantics
version identity
independent business meaning
```

## Recommended deployment strategy

Start with a modular monolith when possible.

```text
many packages
one repository
one Runtime deployment
one PostgreSQL cluster
```

Packages are logical/ownership boundaries first.

A package may later become a deployment/service boundary without forcing the
business model to be redesigned.

## CI

Recommended required checks:

```bash
npm run build
uair lint
npm run check:contracts
npm run check:change-set
```

For architecture review:

```bash
uair impact <changed-node>
uair graph --output architecture.mmd
```

## Code ownership

Use repository-native ownership such as GitHub CODEOWNERS. UAIR does not need a
`Team` primitive in Core.

See [CODEOWNERS Example](../reference/codeowners-example.md).
