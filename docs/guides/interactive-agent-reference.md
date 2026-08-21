# Interactive Agent Reference App

The flagship reference app is:

```text
examples/conversational-agent
```

It demonstrates how UAIR combines a long-running Agent, durable Workflow
control flow, semantic UI surfaces and capability self-extension without
introducing new Runtime Core primitives.

## Run

```bash
npm run build
npm run demo:agent
```

Open:

```text
http://localhost:8789
```

## What it demonstrates

One durable Workflow remains alive across many user turns:

```text
text / voice / click
→ blocking Surface
→ durable Suspension
→ user action
→ resume same Execution
→ Agent intent
→ Component/Capability
→ dynamic Surface
→ wait again
```

The app includes:

```text
welcome surface
customer list
customer detail
free-form text input
browser voice input
capability install proposal
capability generate proposal
explicit approve/reject
durable runtime timeline
```

## Blocking vs non-blocking UI

UAIR intentionally separates:

```text
present(...)
→ non-blocking display
→ does not create Workflow control-flow dependency

surface(...)
→ blocking interaction
→ creates durable Suspension
```

The demo renders both at the same time.

For example, after a CRM query:

```text
display:
"CRM 查询已完成"
(non-blocking)

surface:
customer list
(blocking, waiting for click/text/voice)
```

Showing UI must not implicitly suspend a Workflow.

## One Execution, multiple UI forms

The app does not create a new Agent/Workflow for every message.

Text, voice and list-item clicks all resolve the current blocking Surface and
continue the same:

```text
agent.conversation@2
```

Execution History proves that every prior Surface was resolved and the current
turn remains suspended.

## Capability self-extension UX

The reference app exposes two paths.

Existing package:

```text
"I need FX conversion"
→ capability.install
→ @demo/fx-capability@1.4.0
→ explicit approval required
```

No safe provider:

```text
"I need a weather tool"
→ capability.generate
→ @demo/weather-capability candidate
→ verify/package/governance/approval required
```

The demo deliberately does not download arbitrary third-party code into the
host machine. Approval demonstrates control-plane semantics; production
acquisition remains:

```text
ExtensionController
→ PackageTrustPolicy
→ SandboxRunner
→ trusted package acquisition
```

## Runtime visibility

The browser shows:

```text
Workflow ID
Workflow version
Execution revision
History event count
Execution status
recent durable events
```

This makes the core model observable instead of hiding durability behind a
chat UI.

## Automated acceptance

Run:

```bash
npm run check:interactive-agent-reference
```

It verifies:

```text
text input
click input
dynamic list/detail rendering contract
blocking Surface
non-blocking display
install proposal
generate fallback
explicit approve/reject
same long-running Execution
durable Surface created/resolved History
```
