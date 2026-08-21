# Changelog

## 0.67.0

Final source Release Candidate hardening.

- Added repository hygiene files: `.gitignore`, `.editorconfig`, SECURITY and
  SUPPORT policies, Issue templates, PR template, and base CI.
- Standardized publishable npm metadata: Node engine requirements and public
  scoped-package publish configuration.
- Added npm-facing README files to every publishable workspace.
- Added repository metadata stamping via `release:metadata`; real repository
  URLs are required rather than placeholder URLs.
- Added deterministic dependency-ordered `release:plan`.
- Unified deterministic/Codex Builder capability-provider normalization so
  external providers are reused, target-package capabilities are regenerated,
  and vague `existing` claims without provider/export evidence are rejected.
- Added explicit versioning/breaking-change and publishing policies.
- Added final release checklist and lockfile requirement.
- Generated the root npm lockfile in a networked Node 24 environment.
- Fixed the live PostgreSQL gate to import the published cluster entry point,
  use real clock values in lease/capacity tests, and keep queued job payload
  assignment consistent with database assignment state after reclaim.
- Made real-repository `uair lint` honor conventional non-runtime directories,
  declared package export subpaths, and distinct versions of one Workflow ID.
- Added live PostgreSQL 16 evidence and a 50-cycle resilience soak on macOS.
- Removed stale duplicate top-level Agent/Adapter documentation.
- Added no Runtime Core primitives.

## 0.66.0

Pre-alpha subtractive release-surface hardening.

- Audited security/self-extension authority and explicitly separated operator
  approval from trust/provenance/sandbox/capability authorization.
- Audited Agent compatibility and retained external Agent memory/context/policy
  outside UAIR Runtime semantics.
- Reviewed all packages; no forced package merge is required before alpha.
- Classified examples into golden-path applications and reliability/adapter
  fixtures instead of deleting executable evidence.
- Kept package lifecycle commands nested under `uair package`.
- Improved invalid CLI command/subcommand errors with actionable help guidance.
- Explicitly marked `@uair/core/cluster` and `@uair/forge` experimental.
- Rejected a large universal framework error taxonomy; typed errors remain for
  boundaries where callers need programmatic policy handling.
- Added `check:release-surface-audit`.
- Added no Core primitives and no CLI commands.

## 0.65.0

Pre-v1 API/DX/concept simplification.

- Rewrote the root README as current-product documentation instead of a
  version-by-version development diary.
- Added a formal API/DX/concept audit and release gate.
- Kept the Core primitive set unchanged.
- Made `surface()`, `input()`, `choose()`, and `present()` the single preferred
  UI authoring model.
- Marked legacy `ui()` / `displayUi()` APIs deprecated while retaining v0.x
  compatibility.
- Clarified `deploymentId` and `fingerprint` as advanced Workflow host/tooling
  metadata.
- Kept initial Workflow version `"1"` implicit.
- Documented that UAIR does not impose a stable-ID naming DSL.
- Rejected leading/trailing whitespace in Workflow IDs, Component IDs, and
  Workflow versions to prevent visually ambiguous durable identities.
- Documented v1 application/runtime/cluster/internal API tiers and which outer
  interfaces remain intentionally provisional.
- Deferred a dedicated DevTools product; existing graph/impact/lint/runtime/OTel
  surfaces remain sufficient for alpha.

## 0.64.0

Flagship Interactive Agent reference application, with no Runtime Core semantic
change.

- Upgraded `examples/conversational-agent` to `agent.conversation@2`.
- Added dynamic welcome/list/detail/capability proposal/result Surfaces.
- Added explicit capability approve/reject UI actions.
- Demonstrated installable-package and generate-fallback self-extension UX.
- Demonstrated `present()` non-blocking display alongside blocking `surface()`.
- Added browser runtime facts for Workflow/version/revision/History.
- Added recent durable-event timeline.
- Kept text, voice and UI clicks on one long-running durable Execution.
- Added `check:interactive-agent-reference` black-box durable behavior gate.
- Kept real package acquisition behind ExtensionController/trust/sandbox rather
  than installing arbitrary code in the demo host.

## 0.63.0

Package/plugin ecosystem productization with no Runtime Core semantic change.

- Added `PackageLifecycleController` over standard npm semantics.
- Added package lifecycle receipts for create/verify/pack/publish/install/
  upgrade/rollback.
- Added `NodeNpmPackageLifecycleAdapter`.
- Real npm publication is disabled by default and requires explicit opt-in.
- Publish requires same-version verify and pack evidence.
- Added canonical UAIR manifest validation.
- Added `scaffoldUairPackage()` and `uair package create`.
- Added `uair package verify`, `pack`, `catalog`, `status`, `install`,
  `upgrade`, `rollback`, and gated `publish`.
- Added manifest → installable catalog record projection.
- Added end-to-end package ecosystem gate with real TypeScript compile/npm pack.
- Preserved npm as package manager and registry protocol; no custom registry or
  Runtime Core primitive was introduced.

## 0.61.0

Executable release safety and repeatable production-validation tooling, with no
Runtime Core semantic expansion.

- Added phased deployment adapter hooks for package publication, deployment,
  health verification, traffic cutover and rollback.
- Release attempts now persist phase-by-phase evidence.
- Controller restart can resume an in-progress release from durable
  checkpoints.
- Repeated release approval after successful cutover is idempotent.
- Failed candidate health does not reach cutover.
- Rollback failure is retained as operator evidence.
- ProjectGraph inventory now preserves Component/Capability provider package and
  export symbol metadata.
- Deterministic Builder reuses existing cross-package Components instead of
  redeclaring durable IDs.
- Added real PostgreSQL harness cases for missing-row create races and
  transaction rollback after an injected database error.
- Added multi-seed resilience soak runner and live release environment gate.
- Added `release:check`, `release:live-gate`, and `release:full`.
- Replaced fragile root `tsc -b` entry with dependency-ordered workspace build;
  clean now removes stale `.tsbuildinfo`.
- Clean build from removed `dist`/incremental state verified successfully.

## 0.60.0

Large-project architecture governance with zero Runtime Core semantic changes.

- Added ProjectGraph duplicate durable-declaration evidence.
- Added deterministic architecture governance in `@uair/builder`.
- Hard errors: duplicate durable IDs, package cycles, Workflow cycles, and
  cross-package private deep imports.
- Advisory smells: high Workflow fan-out, deep Workflow chains, optional
  package namespace mismatch, and architecture hotspots.
- Added transitive impact analysis with dependency paths.
- Added Mermaid Code → Graph projection.
- Added `uair lint`, `uair impact`, and `uair graph`.
- Builder candidates now automatically fail on hard architecture governance
  errors.
- Corrected candidate ChangeAnalyzer semantics from stale-source overlay to
  complete-package replacement.
- Added enterprise project organization and CODEOWNERS guidance.
- `packages/core/src` remains byte-for-byte identical to v0.59.

## 0.59.0

Repository/documentation structure cleanup. No Runtime Core semantic change.

- Reduced repository-root Markdown files from 47 to 5.
- Moved architecture, concepts, Agent, Builder, security, operations, release,
  reference, comparison, and historical documents into `docs/`.
- Archived old version-specific release status documents under
  `docs/archive/releases/`.
- Rebuilt `docs/README.md` as the single documentation navigation hub.
- Updated internal documentation/script references after the move.
- Kept only `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `AGENTS.md`, and
  `AI_AUTHORING_GUIDE.md` at repository root.

## 0.58.0

Release-candidate documentation and contributor/AI DX hardening.

- Added one clickable `docs/README.md` documentation entry point.
- Added Quick Start, Core Concepts and Mental Model documentation.
- Added guides for business Workflows, interactive Agents, package development,
  Brownfield integration and production deployment.
- Added maintainer guides for architecture boundaries, durable contracts,
  adapters, storage and release process.
- Added `CONTRIBUTING.md`.
- Added repository-level `AGENTS.md`.
- Added `AI_AUTHORING_GUIDE.md` for Coding Agents.
- Added package-role reference documentation.
- Added Fresh Developer and Fresh AI black-box acceptance specifications.
- Added executable documentation information-architecture/acceptance gate.
- Modernized README first-screen examples to compact native syntax.
- Advanced workspace/adapter compatibility contracts to v0.59.
- No new Runtime Core primitives.

## 0.57.0

Identity/DX hardening and stable operator metrics.

- Kept durable Workflow/Component identity explicit; no inferred file/function
  names are used as persistent protocol identity.
- Initial Workflow version remains implicit `"1"`.
- Added runtime validation for empty/control-character IDs and versions.
- Clarified ordinary TypeScript helper functions require no UAIR identity.
- Switched default `create-uair` example to compact
  `workflow("hello", handler)` syntax.
- Added generated `tsconfig.json`.
- Added real first-run smoke gate: scaffold → compile → execute.
- Added dedicated identity/native-code DX gate.
- Added stable `@uair/ops collectRuntimeMetrics()` snapshot.
- Advanced adapter compatibility snapshot to v0.57.

## 0.56.0

Architecture/DX and operability hardening.

- Added explicit `docs/architecture/layers.md` and machine-readable package-role map.
- Confirmed `@uair/oa`/approval as domain/reference code, not Core.
- Added optional `@uair/ops`; no new Runtime Core primitives.
- Added structured operator error classification.
- Added health/readiness aggregation and storage/worker checks.
- Added graceful worker drain using existing worker lifecycle semantics.
- Added SQLite/PostgreSQL dead-letter requeue and generic recovery helper.
- Fixed stale `create-uair` template from `^0.37.0` to `^0.56.0`.
- Simplified default scaffold to `@uair/core` only.
- Added executable operability and updated DX release gates.

## 0.55.0

Security and compatibility hardening without expanding Runtime Core.

Security:

- Added `SensitiveDataGuardStorage`: raw high-confidence secrets fail closed
  before durable Execution/History persistence.
- Added opaque `SecretRef`; durable replay state stores references, not secret
  values.
- Added trace/export redaction helpers and `@uair/otel` attribute sanitizer.
- Added invocation-time Capability authorization via `bindCapabilities()`.
  Discovery filtering is no longer treated as an authorization boundary.
- Capabilities missing explicit permission metadata fail closed under the RBAC
  authorizer.
- Hardened MCP HTTP connection boundary: HTTPS default, URL credentials denied,
  private/loopback/link-local/CGNAT address blocking, every DNS answer checked.
- Hardened MCP stdio: arbitrary process launch is denied without an explicit
  process policy.
- Added package post-install verification: identity/version/integrity,
  provenance, lifecycle script/native addon/network/filesystem/secret evidence.
- Trusted package identity no longer bypasses behavior policy.
- Added `TenantStorage` logical namespace and hostile same-ID cross-tenant
  isolation tests.
- Added executable Security P0 hostile suite to release preflight.

Upgrade/compatibility:

- Fixed future durable History schema acceptance. Older Runtime now fails closed
  with `HistorySchemaTooNewError`.
- Added N-1/N/N+1 History and SQLite storage compatibility gate.
- Added same-storage-schema mixed-writer rolling window verification.
- Added adapter public API snapshot/semver policy for eight integration packages.
- Added real local npm package lifecycle test:
  install 1.0.0 → upgrade 1.1.0 → rollback 1.0.0.
- All new gates are included in release preflight.

## 0.54.0

Production hardening: transactional storage, crash recovery, queue faults and
storage schema compatibility.

- Added `PostgresRuntimeState` for shared durable Execution/Suspension state.
- PostgreSQL execution revisions now use one atomic
  `INSERT ... ON CONFLICT ... WHERE revision = expected RETURNING revision`
  fence, including missing-row races.
- Added PostgreSQL Runtime inbox, event-receipt and outbox persistence views.
- Extended real PostgreSQL Docker/GitHub integration harness with 12-way
  Runtime revision race, execution+suspension transaction atomicity and
  newer-storage-schema refusal.
- Added explicit SQLite Runtime storage schema version metadata.
- Added legacy SQLite schema upgrade verification.
- Older Runtime binaries now fail closed on newer SQLite storage schema.
- Added five SQLite critical transaction crash injection points.
- Crash verification uses real child-process `SIGKILL`, reopens the DB,
  verifies logical rollback/index consistency and runs `PRAGMA integrity_check`.
- Added 12-connection SQLite optimistic concurrency attack: one winner,
  eleven revision conflicts.
- Added queue duplicate/reorder/delay/lease-expiry/stale-ack matrix.
- Fixed SQLite reliable-queue retry projection bug where `assigned_worker_id`
  was cleared but serialized `job.workerId` stayed pinned, leaking shared
  capacity and starving resumable executions under chaos/reclaim.
- Chaos recovery phase now rebuilds missing queue delivery intents from
  durable `resume_requested` history, matching RuntimeEngine recovery semantics.
- Defined supported production storage/queue profiles; JSON/InMemory adapters
  are explicitly development-only.
- Added formal Runtime/Gateway/Adapter threat model.
- Added macOS final-release validation checklist for PostgreSQL, live Codex and
  live external Agent frameworks.
- Release preflight now includes local storage schema, SQLite concurrency,
  crash-point, queue-fault and PostgreSQL structural gates.

## 0.53.0

Production-readiness program and cross-framework Agent compatibility matrix.

- Added `docs/operations/production-readiness.md` with P0/P1 gates for correctness, security, upgrades, operations, performance, Brownfield adoption, Agent compatibility and DX.
- Added `docs/architecture/core-principles.md` as a strict admission rule for future Core primitives.
- Added `docs/agent/compatibility-matrix.md`.
- Verified OpenAI-Session-shaped, LangGraph-thread-shaped and Claude-session-shaped ownership models through the existing opaque `externalAgent()` boundary.
- Verified external runtime restart while framework-owned memory/checkpoints/skills remain outside UAIR History.
- Verified the inverse topology where an Agent remains outer orchestrator and calls a UAIR Workflow as a durable tool.
- Documented LangGraph's checkpoint/latest-graph compatibility model as distinct from UAIR's explicit Workflow-version isolation.
- Added `check:agent-compatibility` release gate.
- Added no new Runtime Core primitive for Agent Memory, Skill, Thread, Session or Checkpoint.
- Added `check:suspension-race` and fixed generic resolve-vs-cancel concurrency: both now compete through optimistic execution revision and exactly one durable terminal event may win.
- Extended the suspension race gate to simultaneous event-vs-timer resolution; exactly one resolution value and one resume intent may commit.
- Fixed UI Surface release test isolation: RuntimeEngine default inbox/outbox/event-receipt files are now scoped to the test temp directory, eliminating order-dependent stale event IDs in preflight.
- Fixed release-preflight ordering so compatibility/race gates execute before the final PASS banner.
- Made the fake-Codex protocol fixture self-chmod during test setup so source archive transport does not create a false release failure.

## 0.52.0

Agent framework Memory/Context/Skill compatibility boundary.

- Added `externalAgent()` adapter in `@uair/agent` for existing Agent runtimes.
- External Agent memory, context, checkpoint and Skill internals remain opaque to UAIR.
- External Agent suspension is represented as a turn result containing an opaque `sessionRef`; the containing UAIR Workflow owns the actual Suspension/Interaction.
- Added `durableWorkflowTool()` so an existing Agent can remain outer orchestrator while invoking a UAIR Workflow as a durable tool.
- Added direct-vs-UAIR semantic equivalence verification.
- Added assertions that private Agent memory, system context and Skill instructions never enter UAIR History.
- Added external Agent runtime restart verification: a fresh Agent instance restores its own checkpoint using only the opaque sessionRef replayed by UAIR.
- Verified Agent Skill invocation count and availability are unchanged by UAIR hosting.
- Verified an outer Agent retains its own memory and Skill registry when calling UAIR.
- Added no new Runtime Core Agent, Memory, Context or Skill primitives.
- Tightened an existing Workflow fingerprint adoption type narrowing without changing its runtime semantics.

## 0.51.0

Minimal durable human Interaction / Inbox layer.

- Added `@uair/interaction`.
- Kept Runtime Core free of User/Role/Department/Channel/Approval/Task concepts.
- Human Interaction is implemented as a typed existing Suspension spec.
- Added opaque `assignee` + semantic `kind` + payload contract.
- Added `InteractionService.listPending()`, authorized single-item reads and authorized resolve.
- Default authorization is exact actor/assignee identity; delegation/role/group logic is injected by the host.
- Expired interactions are not presented as actionable Inbox items.
- Sequential duplicate resolves are recovered idempotently from durable History.
- Added generic optional `SuspensionResolved.resolvedBy` audit identity.
- Added optimistic revision fencing to generic suspension resolution so concurrent device clicks cannot last-writer-overwrite an earlier durable decision.
- SQLite combined suspension save/remove operations now honor expected execution revision.
- Added production-style `createInteractiveOaPackage()` while preserving the previous OA API.
- Organization lookup is modeled as durable Components/capabilities rather than naked external calls.
- Added centralized OA HTTP demo: employee submission → manager Inbox → director Inbox → completion.
- Extended Builder ProjectGraph to understand `interaction<Payload, Result>(kind)` as the existing Surface contract concept.
- Extended ProjectGraph to recognize string-form Workflow/Component declarations, removing another source-form blind spot.
- Verified Workflow → Interaction graph edges and interaction payload/result ContractGraph visibility.
- Added end-to-end attacks for unauthorized reads/resolves, delegation, duplicate/concurrent approval, audit actor identity and two-stage approval.

## 0.50.0

Codex-backed Builder phases.

- Added `CodexCliClient` for official non-interactive `codex exec` integration.
- Uses `--ephemeral`, `--output-schema`, and `--output-last-message`.
- Added strict JSON Schemas for BusinessSpec, BuildPlan, and generated artifact output.
- Added `CodexRequirementAnalyst`, `CodexSolutionArchitect`, and `CodexArtifactImplementer`.
- Added `createCodexBuilderDefaults()`.
- UAIR CLI now defaults `uair build` to the Codex backend.
- Added `--backend codex|deterministic`, `--codex-bin`, and `--model`.
- There is no silent fallback from failed Codex invocation to deterministic generation.
- Kept verification, ChangeSet, Contract, Runtime, Migration, Deployment, release and retirement outside the model boundary.
- Removed a leave-specific/format-specific Workflow ID magic value from `StructuralArtifactVerifier`; verification now checks BuildPlan Workflow IDs generically.
- Added fake-Codex executable to verify actual subprocess protocol without falsely claiming a model call.
- Added full Codex-backed Builder test: Analyst → Architect → Implementer → deterministic UAIR gates.
- Codex-generated candidate is materialized and TypeScript compiled during verification.

## 0.49.0

Release Controller and operational Builder CLI.

- Added reusable `ReleaseController` in `@uair/builder`.
- Added `DeploymentAdapter` abstraction and local receipt adapter.
- Added explicit approval gates for release and old-deployment retirement.
- Added fresh Runtime status evaluation before retirement.
- Retirement counts only executions pinned to the previous Workflow version.
- Added persistent release controller state and deployment/retirement receipts.
- Added new `@uair/cli` package with `uair` binary.
- Added `uair build`, `uair review`, `uair release`, `uair status`, and `uair retire`.
- `uair build` materializes candidate package, migration metadata, deployment plan, and Release Proposal.
- `release`/`retire` require `--approve`.
- Added end-to-end CLI lifecycle verification covering blocked unapproved release, blocked early retirement, execution drain, and successful retirement.
- Kept real infrastructure mutation behind a replaceable DeploymentAdapter.

## 0.48.0

Release/deployment planning and explicit old-version retirement gates.

- Added `DeploymentPlan`, `DeploymentStep`, and `RetireGate`.
- Added `DeploymentPlanner`, `ConservativeDeploymentPlanner`, and `evaluateRetireGate()`.
- Project-aware Builder now produces DeploymentPlan after MigrationPlan.
- Rollout is split into deploy, cutover, retain and retire phases.
- New executions route to the proposed Workflow version while old executions remain pinned.
- Retirement is blocked until running + suspended executions for the old version reach zero.
- Runtime Impact now records deployment usage and version-scoped deployment usage.
- Fixed deployment selection so v2 retirement cannot accidentally target a v1 deployment.
- Added `deployment/release-plan.json` release artifact.
- Added executable drain verification: retire gate is blocked with active executions and opens after they drain.
- Builder Showcase now renders the deployment lifecycle and retire state.
- Release preflight includes the deployment planner gate.

## 0.47.0

Migration planning and version-isolated release remediation.

- Added `MigrationPlan`, migration strategies, actions, artifacts and verification evidence.
- Added `MigrationPlanner` interface and `ConservativeMigrationPlanner`.
- Project-aware Builder now plans migration after ChangeSet, contract and runtime analysis.
- Contract incompatibility no longer automatically means release failure when a verified migration strategy isolates old executions from the new contract.
- Added `version-isolation` as the default safe strategy for version-advanced Workflows with active durable executions.
- Planner requires old Workflow/deployment availability, pins old executions to old versions, and routes new executions to the proposed version.
- Added generated `migration/version-isolation.json` release artifact.
- Added compatibility-adapter and explicit WorkflowUpgrade options, conservatively marked unsafe unless their prerequisites are proven.
- Added executable verification that `VersionedWorkflowRegistry` resolves old v2 executions to v2 and new v3 executions to v3.
- Builder Showcase now displays Migration Plan actions alongside ChangeSet, Contract Compatibility and Runtime Impact.
- Release preflight now includes the Migration Planner gate.

## 0.46.0

Contract Graph and durable payload compatibility.

- Added TypeScript-derived `ContractShape` projection in `@uair/builder`.
- ProjectGraph nodes can now carry Component/Capability input/output contracts and Surface data/action contracts.
- Added `analyzeContractCompatibility()`.
- Detects required Component input additions as `INPUT_CONTRACT_NARROWED`.
- Detects removed/incompatible Component outputs as `OUTPUT_CONTRACT_BROKEN`.
- Detects Surface data narrowing as `SURFACE_DATA_CONTRACT_NARROWED`.
- Detects Surface action narrowing as `SURFACE_ACTION_CONTRACT_NARROWED`.
- Project-aware Builder now reads unresolved durable Surface payloads and validates them against candidate contracts.
- Incompatible persisted payloads produce `PENDING_SURFACE_PAYLOAD_INCOMPATIBLE`.
- `FilesystemChangeAnalyzer` now returns ChangeSet, Change Safety and Contract Compatibility together.
- Builder blocks release proposal creation on contract incompatibility.
- Release Proposal now carries `contractCompatibility` evidence alongside structural change and live-runtime impact evidence.
- Builder Showcase now displays contract compatibility and durable payload checks.
- Release preflight now includes Builder, ProjectGraph, ChangeSet, Contract, Surface and Forge gates.

## 0.45.0

Symbol-aware ProjectGraph and ChangeSet governance.

- Replaced regex-only declaration analysis with TypeScript compiler API parsing in `@uair/builder`.
- Added symbol-level `uses` edges across relative imports.
- Added Workflow → Surface semantic usage edges.
- Added implementation fingerprints for ProjectGraph nodes.
- Added `ChangeSet` (`ADD` / `MODIFY` / `REMOVE`) with reverse transitive dependent analysis.
- Added `analyzeChangeSetSafety()`.
- Blocks Workflow implementation changes made without durable version advancement.
- Blocks removal of nodes that still have dependent graph nodes.
- Added `FilesystemChangeAnalyzer` to compare current source against generated candidate artifacts in an isolated temporary project.
- Project-aware Builder now gates Release Proposal creation on ChangeSet safety.
- Release Proposals now include `changeSet`, `changeSafety`, and live Runtime impact together.
- Builder Showcase now displays ChangeSet counts, affected nodes, safety, runtime risk, and `v2 → v3` evolution.

## 0.44.0

Project-aware Builder evolution.

- Added `ProjectGraph`, graph nodes/edges and filesystem project scanning.
- Added `FsProjectGraphInspector` to derive Builder inventory from real UAIR source projects.
- Added `DurableRuntimeImpactAnalyzer` backed by Runtime `Storage.listExecutions()`.
- Runtime impact reports active/suspended execution counts, observed Workflow versions and pending suspension components.
- Added planned `workflowVersions` to `BuildPlan`.
- Existing numeric Workflow identities now advance automatically (`v2 → v3`) rather than being overwritten.
- Requirement analysis now carries simple approval-threshold changes into generated Workflow code.
- Upgraded Builder Showcase to evolve a real `@acme/leave@1.2.0` fixture with `hr.leave.request@2` and live durable executions.
- Verified source version detection, high-risk runtime impact, v3 generation and changed `> 2 days` business behavior.

## 0.43.0

UAIR Builder MVP.

- Added experimental `@uair/builder`.
- Added durable `uair.builder.build` development Workflow.
- Added `BusinessSpec`, `BuildPlan`, `ReleaseProposal`, Preview and Impact contracts.
- Added explicit phase interfaces for project inspection, analysis, architecture, implementation, verification, impact analysis, preview and release planning.
- Added deterministic reference implementations for reproducible Builder testing.
- Added guarded `materializeArtifacts()` with path traversal protection.
- Added generated company-package TypeScript compilation verification.
- Added Builder Showcase for “natural language requirement → company package proposal”.
- Verified generation of `@acme/leave` with fixed approval Workflow, semantic Surfaces, capability reuse/generation decisions and test artifacts.

## 0.42.0

UI protocol simplification.

- Added renderer-neutral `SurfaceSpec` / `SurfaceAction`.
- Added explicit wire marker `uair.surface/v1`, injected automatically.
- Added blocking `surface()`, `input()`, and `choose()` sugar APIs.
- Added non-blocking `present()` semantic display helper.
- Added `SurfaceRendererRegistry` for React/Vue/native/other adapters.
- Migrated the Conversational Agent flagship demo from its private dynamic-view transport to the shared Surface protocol.
- Added executable `check:surface` durability/protocol verification.
- Kept all UI protocol code outside Runtime Core.

## 0.37.0

Release-candidate hardening.

- Selected the MIT License and applied it consistently across publishable packages.
- Added a release preflight script covering license metadata, build/API/DX/Agent validation, fault harnesses, and npm pack dry-runs.
- Kept npm namespace ownership as an explicit external release blocker.
- Prepared soak-test infrastructure for large execution runs.

## 0.37.0

Release-polish and developer-experience hardening.

### Preferred identity API

Added object-form durable definitions:

```ts
workflow({
  id: "order.approval",
  version: "1",
  async run(input) {}
});

component({
  id: "payments.charge",
  async run(input, ctx) {}
});
```

Workflow and Component definitions expose stable `.id` properties. Legacy `.name` / `.componentName` aliases remain for v0.x compatibility.

`RuntimeEngine` now accepts Workflow arrays directly, eliminating repeated registry string keys.

### Agent tool identity

`asAgentTool(component)` now derives its default model-facing tool name from `component.id`. Agent decisions can reference `search.id` instead of repeating string literals.

### Runtime argument validation seam

Agent tools now support `parseArgs(value)` so Zod, Valibot, ArkType, custom validators, or other existing schema ecosystems can validate model-generated arguments before execution. UAIR does not introduce a new schema DSL.

### Publish hardening

Added `docs/concepts/durable-identity.md`, `docs/comparisons/deepseek-harness.md`, `docs/release/publish-decisions.md`, `scripts/check-developer-experience.mjs`, and `scripts/check-agent-validation.mjs`. Package descriptions and scoped-package public access metadata were added.

### Still required before a public release announcement

- confirm npm namespace ownership
- select a legal license
- observe the real PostgreSQL CI gate green
- complete larger soak testing
