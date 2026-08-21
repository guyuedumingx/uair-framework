# Release Process

UAIR releases should be evidence-driven.

## Before cutting a release

1. freeze new Core concepts;
2. run monorepo TypeScript build;
3. run local release preflight;
4. run package dry-runs;
5. run environment-dependent gates from `../release/mac-validation.md`;
6. review durable ChangeSet/contract compatibility;
7. verify changelog and migration notes;
8. retain release evidence.

## Environment-dependent evidence

Depending on the claim:

```text
real PostgreSQL
old/new mixed-binary rolling upgrade
real Codex
OpenAI Agents SDK
LangGraph
Anthropic/Claude
Gateway/tenant/network sandbox
registry provenance
```

Do not convert “test prepared” into “test passed”.

## Release authority

AI output is not release authorization.

Builder/Agent may prepare code and evidence, but release/retire actions remain
explicit controller/operator decisions.
