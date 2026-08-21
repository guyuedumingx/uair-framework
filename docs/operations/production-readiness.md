# UAIR Production Readiness Program — v0.67

The project is now feature-rich enough that adding more abstractions is less
important than proving production behavior.

The rule from this version onward:

> A new Core primitive is not justified by a missing production feature.
> Prefer tests, adapters, storage guarantees, operational controls and outer
> packages first.

## Release gates before 1.0

### P0 — correctness and durable safety

These are blockers.

- [x] deterministic/replay-oriented Core execution model
- [x] durable Suspension / resume
- [x] Effect idempotency foundations
- [x] optimistic concurrent suspension resolution
- [x] Workflow version identity
- [x] Runtime Impact + old-version drain/retire gate
- [x] ChangeSet safety
- [x] contract compatibility + persisted payload checks
- [x] release/migration/deployment planning
- [x] phased deployment execution adapter: publish → deploy → health → cutover → rollback
- [x] release-controller checkpoint/restart recovery + repeated-approval idempotency
- [x] human Interaction authorization/idempotency
- [x] Agent state-ownership boundary
- [x] cross-framework Agent compatibility model matrix
- [ ] database-level adversarial concurrency suite across SQLite + PostgreSQL — SQLite PASS; PostgreSQL harness now covers revision race + missing-row create race, live DB execution pending
- [ ] crash-at-every-commit-point exhaustive fault injection — SQLite SIGKILL critical points PASS; PostgreSQL harness now includes injected DB-error transaction rollback, live DB + broader failover matrix pending
- [x] queue duplicate/reorder/delay fault matrix — local/in-memory + SQLite reliable queue
- [x] cancellation race matrix (resolve vs cancel first-durable-winner)
- [x] timer/event simultaneous-winner race matrix (single resolution + single resume intent)
- [x] storage corruption / partial-write recovery policy — production profiles defined; SQLite SIGKILL + integrity_check verified; JSON storage explicitly non-production
- [ ] schema migration compatibility for Runtime storage itself — SQLite legacy→current + newer-schema refusal PASS; PostgreSQL schema gate implemented, live DB pending

### P0 — security

- [x] authorization kept outside Core business semantics
- [x] Interaction read/resolve authorization
- [x] explicit release/retire approval
- [x] formal threat model for Runtime/Gateway/Adapter boundaries
- [x] secret-redaction policy for History/trace/metrics — durable raw secrets fail closed via Storage guard; OTel export sanitizer provided
- [x] capability permission enforcement matrix — invocation-time principal binding; missing permission fails closed
- [x] SSRF / untrusted MCP / plugin boundary tests — HTTP private-address/DNS policy, stdio process policy, sandbox/package behavior gate
- [x] package provenance/signature policy for generated or installed packages — integrity/provenance + behavior evidence verifier
- [x] tenant-isolation reference architecture + hostile cross-tenant tests — TenantStorage same-ID isolation; physical DB/schema isolation remains recommended

### P0 — upgrade and compatibility

- [x] Workflow version isolation
- [x] implementation fingerprint + same-version mutation rejection
- [x] ContractGraph compatibility
- [x] MigrationPlan + DeploymentPlan + RetireGate
- [x] Agent framework compatibility ownership rules
- [ ] UAIR Core N-1 / N / N+1 storage-format compatibility suite — History + SQLite PASS including future-schema refusal; PostgreSQL live DB pending
- [ ] rolling-upgrade test with mixed Runtime binary versions — v0.54/v0.55 share SQLite schema v2 and same-schema mixed-writer window PASS; real previous-binary + PostgreSQL rolling test pending
- [x] adapter API compatibility policy and semver conformance tests — machine-readable public adapter export snapshot + release gate
- [x] package install/upgrade/rollback end-to-end test — real local npm tarball 1.0.0 → 1.1.0 → 1.0.0

### P1 — operability

- [x] CLI release lifecycle
- [x] OpenTelemetry package foundation
- [x] process crash harness / chaos harness / soak foundation
- [x] multi-seed resilience soak runner + short smoke gate
- [ ] overnight/long-duration soak evidence on release hardware/CI
- [x] stable metrics contract — optional `@uair/ops collectRuntimeMetrics()` snapshot for executions/suspensions/workers/dead letters
- [ ] trace correlation across UAIR ↔ Component ↔ external Agent/MCP
- [x] structured error taxonomy and actionable operator messages — `@uair/ops classifyError()`
- [x] dead-letter / poison execution operator workflow — adapter `requeueDead()` + `@uair/ops recoverDeadLetter()`
- [ ] backup/restore runbook and restore verification
- [ ] capacity model and backpressure behavior
- [x] graceful shutdown/drain verification — `active → draining → offline` reference flow
- [x] health/readiness contract/reference helpers — endpoint framework wiring remains Host-specific

### P1 — performance and scale

- [ ] baseline benchmark suite with published methodology
- [ ] 10k/100k suspended execution storage benchmark
- [ ] resume latency benchmark under contention
- [ ] high-cardinality History size benchmark
- [ ] large ProjectGraph / Builder analysis benchmark
- [ ] queue throughput/backpressure benchmark
- [ ] memory profile and leak soak
- [ ] cost model for Agent-heavy workloads

### P0 — AI Builder self-extension

- [x] ProjectGraph-backed existing capability reuse
- [x] package catalog discovery interface
- [x] deterministic `Reuse → Install → Generate` resolution
- [x] installable package dependency/public-export integration
- [x] required generated-capability materialization gate
- [x] explicit CapabilityExtensionPlan
- [x] explicit extension acquisition approval
- [x] release blocked until required extensions are satisfied
- [x] trusted acquisition bridge through PackageTrustPolicy + SandboxRunner
- [x] generated package/Workflow/Surface/test proposal remains release-governed
- [x] Forge install-before-generate alignment

### P1 — Brownfield adoption

- [x] Component boundary supports existing APIs/services conceptually
- [x] centralized host + legacy frontend compatibility architecture defined
- [ ] OpenAPI importer → capability inventory
- [ ] MCP importer → capability inventory
- [ ] npm/package inventory resolver
- [ ] webhook/event correlation adapter reference
- [ ] idempotency adapter for legacy non-idempotent APIs
- [ ] reference Spring/Vue brownfield integration
- [ ] reference commerce/non-OA integration
- [ ] reference risk/asset or IoT integration

### P1 — Agent compatibility

- [x] generic opaque sessionRef boundary
- [x] Agent hosted by UAIR
- [x] Agent calls UAIR Workflow
- [x] process restart without copying memory/skills
- [x] OpenAI Agents SDK-shaped compatibility harness
- [x] LangGraph-shaped compatibility harness
- [x] Claude-session-shaped compatibility harness
- [ ] live OpenAI Agents SDK adapter test in authenticated CI
- [ ] live LangGraph adapter test using official package + durable checkpointer
- [ ] live Claude Agent/Managed Agent adapter test in authenticated CI
- [ ] cancellation/streaming/backpressure matrix for live adapters
- [ ] provider session expiry/recovery matrix

### P1 — documentation and contributor experience

- [x] documentation information architecture / landing page
- [x] five-minute Core-only Quick Start
- [x] user mental model and package map
- [x] maintainer architecture/durable-contract guides
- [x] `CONTRIBUTING.md`
- [x] repository `AGENTS.md`
- [x] AI authoring rules
- [x] Fresh Developer acceptance specification
- [x] Fresh AI acceptance specification
- [ ] independent Fresh Developer execution evidence
- [ ] independent fresh Coding Agent execution evidence

### P1 — developer experience

- [x] clean-checkout dependency-ordered workspace build
- [x] one-command `release:check` (clean → build → preflight)
- [x] real-environment `release:live-gate` entry point

- [x] npm packages and create-uair baseline
- [x] deterministic Builder and Codex backend boundary
- [ ] one-command local production-like stack
- [ ] generated app upgrade tutorial
- [ ] compatibility diagnostics command (`uair doctor`)
- [ ] Runtime inspection command/UI
- [ ] error messages with remediation links/codes
- [ ] minimal stable public API audit before 1.0

## Production compatibility matrix

Every new Runtime/Core change must be exercised against domains that do not
share business vocabulary:

```text
OA / approval
commerce / checkout
asset lifecycle
risk decisioning
restaurant ordering
IoT/event automation
open-ended Agent
background batch/job processing
```

A proposed Core concept must be rejected if it is merely convenient for one of
these domains and can be expressed using existing primitives + packages.

## Agent framework matrix

Every Agent adapter must record:

```text
outer orchestrator owner
session/checkpoint owner
memory owner
skill/tool owner
interrupt/resume owner
version compatibility owner
cancellation semantics
streaming semantics
session expiry semantics
```

The adapter is production-ready only when those ownership fields have exactly
one authoritative system each.

## 1.0 definition

UAIR should not call itself production-grade merely because demos work.

A 1.0 candidate requires:

```text
all P0 gates green
no known dual-authority durable state
repeatable crash/concurrency results
rolling upgrade evidence
published compatibility guarantees
at least one non-OA brownfield reference integration
at least two live external Agent framework integrations
operator recovery/runbook evidence
```

This checklist is intentionally conservative. Missing convenience features do
not block 1.0; unresolved correctness, security, recovery or upgrade behavior
does.


### P1 — large-project architecture governance

- [x] duplicate durable-ID detection
- [x] package dependency-cycle detection
- [x] Workflow dependency-cycle detection
- [x] cross-package private deep-import detection
- [x] configurable architecture-smell thresholds
- [x] transitive impact-path analysis
- [x] Mermaid Code → Graph projection
- [x] Builder candidate hard gate for architecture errors
- [x] CLI `lint`, `impact`, and `graph`
- [x] enterprise package/ownership reference guide


### P1 — package/plugin ecosystem

- [x] standard npm package contract (`<package>/uair`)
- [x] package scaffold CLI
- [x] manifest validation
- [x] package verify command
- [x] immutable npm pack artifact + integrity receipt
- [x] catalog-record projection
- [x] package status/lifecycle receipts
- [x] explicit publish authorization
- [x] real npm publish disabled by default
- [x] verify + pack required before publish
- [x] install/upgrade/rollback lifecycle controller
- [x] same-version install idempotency
- [x] existing npm tarball install → upgrade → rollback test
- [x] AI Builder `Reuse → Install → Generate` compatibility
- [ ] real private/public registry provenance publication test — deferred to final real-environment validation
- [ ] marketplace/catalog service reference implementation — not required for alpha


### P1 — interactive Agent reference

- [x] one long-running durable conversational Workflow
- [x] text input
- [x] browser voice input adapter
- [x] dynamic list/detail Surfaces
- [x] UI click and free-text share one action/resume path
- [x] blocking Surface semantics demonstrated
- [x] non-blocking display semantics demonstrated
- [x] capability install proposal UI
- [x] capability generate-fallback proposal UI
- [x] explicit approve/reject interaction
- [x] runtime execution/revision/History visibility
- [x] recent durable-event timeline
- [x] black-box same-Execution/durable-turn verification


### P1 — pre-v1 API / DX simplification

- [x] root README converted from development diary to current-product guide
- [x] compact Workflow/Component syntax remains primary
- [x] implicit initial Workflow version retained
- [x] durable ID naming remains convention-based, not a Core DSL
- [x] leading/trailing identity/version whitespace rejected
- [x] preferred UI authoring converged on `surface/input/choose/present`
- [x] legacy `ui/displayUi` marked deprecated instead of adding another abstraction
- [x] deployment/fingerprint metadata classified as advanced host/tooling options
- [x] application/runtime/cluster/internal API tiers documented
- [x] full DevTools product explicitly not required for public alpha
- [x] deterministic `check:api-dx-audit` release gate
