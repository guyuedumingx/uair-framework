# Fresh Developer Acceptance

Purpose: test whether a developer with no UAIR project history can build a
useful application from published documentation.

## Rules

Give the developer only:

```text
published repository
README
npm packages
normal internet/package-manager access
```

Do not explain UAIR verbally.

## Task

Build a small interactive research application:

```text
user submits a topic
→ existing/fake research API is called
→ results are presented as a selectable interaction
→ user chooses one result
→ Workflow resumes
→ selected result is persisted/returned
```

The research API may be mocked. The test is about UAIR structure, not model
quality.

## Expected architecture

```text
normal parsing/formatting
→ ordinary TypeScript

research API boundary
→ Component

long-running process
→ Workflow

user selection
→ Interaction/UI

no RBAC/Tenant/OA unless the developer independently needs them
```

## Pass criteria

- project starts from documented Quick Start;
- developer does not modify `@uair/core`;
- Workflow has one stable ID;
- initial version may remain implicit;
- pure helpers remain ordinary functions;
- external research call is a Component;
- user choice suspends and resumes durably;
- restart does not lose pending interaction;
- code compiles and focused tests pass.

## Failure signals

```text
every helper turned into component()
Approval/OA imported for generic user selection
RBAC/Tenant added without a requirement
custom workflow state machine duplicates UAIR History
durable ID derived from file/function name
Interaction result stored only in frontend memory
```

Record:

```text
time to first successful run
questions/blockers
docs consulted
incorrect architectural choices
API friction
```
