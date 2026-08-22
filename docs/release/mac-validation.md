# UAIR macOS Final Release Validation — v0.67

Use this checklist for environment-dependent gates. The PostgreSQL and
50-cycle live gate were executed successfully on the final macOS validation
host; repeat them for the exact release commit.

## 1. Toolchain

Recommended:

```bash
node --version
# Node 22.x or newer

npm --version
git --version
```

Install repository dependencies:

```bash
npm install
```

Run the clean local release gate:

```bash
npm run release:check
```

This performs:

```text
clean
→ dependency-ordered workspace build
→ release preflight
```

Expected:

```text
UAIR release preflight: PASS
```

## 2. Real PostgreSQL integration — REQUIRED

On a Mac with Docker Desktop:

```bash
docker run --name uair-postgres-test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=uair_test \
  -p 5432:5432 \
  -d postgres:16
```

Install the integration dependency if the workspace install did not already
provide it:

```bash
npm install pg@^8.13.0
```

Run:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/uair_test \
npm run test:postgres
```

v0.67 must show all of these:

```text
✓ concurrent claim
✓ concurrent reclaim
✓ shared registry
✓ atomic capacity reservation
✓ two schedulers / one capacity slot
✓ runtime concurrent revision
✓ runtime concurrent create
✓ runtime transaction rollback on database error
✓ runtime suspension atomicity
✓ runtime schema forward refusal

UAIR PostgreSQL integration verification: PASS
```

Then:

```bash
docker rm -f uair-postgres-test
```

## 3. Re-run SQLite crash gates on macOS

Node's `node:sqlite` is platform/runtime dependent. Run:

```bash
npm run check:storage-schema
npm run check:sqlite-adversarial
npm run check:sqlite-crash-points
npm run check:suspension-race
npm run check:queue-faults
```

All must pass.

## 4. Package publish shape

Run:

```bash
for p in packages/*; do
  if [ -f "$p/package.json" ]; then
    (cd "$p" && npm pack --dry-run)
  fi
done
```

No package should unexpectedly include:

```text
node_modules
.uair runtime state
credentials
local databases
temporary candidates
```

## 5. Codex — OPTIONAL FOR CORE RELEASE, REQUIRED FOR CODEX BACKEND CLAIM

The current build container did not have a real authenticated Codex CLI.

On the Mac:

```bash
codex --version
codex login
```

Then run a real project:

```bash
uair build \
  --backend codex \
  --requirement "在测试项目中新增一个最小固定业务流程"
```

Verify that:

```text
Codex performs Analyst/Architect/Implementer
candidate compiles
UAIR deterministic safety gates still run
no release occurs without explicit approval
```

The fake-Codex protocol test is not a substitute for this live check.

## 6. Live external Agent frameworks — REQUIRED BEFORE GENERAL AGENT-COMPAT CLAIM

Still environment-dependent:

```text
OpenAI Agents SDK authenticated adapter
LangGraph official package + durable checkpointer
Claude/Anthropic session/agent adapter
```

For each, verify:

```text
native session/checkpoint remains framework-owned
native memory remains framework-owned
native skill/tool behavior preserved
runtime restart succeeds
cancel/stream/backpressure behavior documented
provider session expiry behavior documented
```

## 7. Release decision

Do not call UAIR `production-grade 1.0` until every P0 item in
`../operations/production-readiness.md` is checked.

A v0.x/npm alpha release may proceed with explicitly documented unsupported
profiles and environment-dependent gates.


## 8. Security environment integration — REQUIRED FOR PRODUCTION CLAIMS

Local hostile policy tests:

```bash
npm run check:security-hardening
```

Then validate the real Host environment:

```text
Gateway authenticates actor + tenant before UAIR access
secret manager resolves SecretRef outside durable History
network sandbox/egress rules enforce the same or stricter MCP/package policy
package registry returns integrity/provenance evidence
tenant A cannot query tenant B through Gateway, queue, Runtime DB or business DB
```

The in-process policy tests are not a substitute for OS/network/Gateway
enforcement.

## 9. Previous-binary rolling upgrade

v0.58 locally verifies History/SQLite N-1/N/N+1 semantics and a same-schema
mixed-writer window.

The live release gate now installs the published previous release and runs it
beside the candidate against a disposable shared PostgreSQL database:

```text
old workers continue pinned Executions
new workers start new Executions
no future-schema reader writes
revision conflicts remain first-writer-safe
rollback is refused if storage schema is too new
```

Keep this as CI evidence for every storage-schema-changing release.

Current evidence:

```text
previous binary       0.67.0 from npm
candidate binary      0.68.0 local build
shared writes         PASS
revision race         exactly one writer accepted
old pinned resume     draining v1 worker
new admission         active v2 worker
shutdown              only after old queue/active counts reach zero
```


## 10. Independent documentation acceptance — REQUIRED BEFORE PUBLIC ALPHA TAG

### Fresh developer

Give a developer with no UAIR history only the repository/npm packages.

Use:

```text
docs/acceptance/fresh-developer.md
```

Do not coach them. Record:

```text
time to first successful run
docs consulted
questions/blockers
architectural mistakes
API friction
```

A pass requires no Core modification and correct Workflow/Component/Interaction
boundaries.

### Fresh Coding Agent

Start a genuinely fresh Codex/Claude Code/other coding-agent session with no
prior UAIR conversation context.

Give it only the repository and:

```text
docs/acceptance/fresh-ai.md
```

Keep the final agent report as release evidence.

Hard fail if it adds domain primitives to Core, invents a second durable state
machine, treats ordinary helpers as Components indiscriminately, or bypasses
release/security gates.


## 11. Live release gate

After PostgreSQL is available and the clean release check passes:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/uair_test \
UAIR_LIVE_SOAK_CYCLES=50 \
npm run release:live-gate
```

This runs the real PostgreSQL integration/fault harness followed by a
multi-seed local resilience soak.

For the final alpha release candidate, keep the terminal output as release
evidence.

For a one-command environment with `DATABASE_URL` already exported:

```bash
npm run release:full
```

which executes:

```text
release:check
→ release:live-gate
```
