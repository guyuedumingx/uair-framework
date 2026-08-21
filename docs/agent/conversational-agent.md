# Conversational Agent Demo

## Core idea

The demo is one long-running Workflow, not one Workflow per message.

```ts
for (;;) {
  const action =
    await nextTurn({
      view,
      transcript
    });

  view =
    await respond(
      action
    );
}
```

`nextTurn` is a normal blocking UAIR UI Component. Therefore every wait for a user message or click is durable.

## Input types

```text
message
select
```

A browser text/voice command produces `message`.

Clicking a rendered list item produces `select`.

Both enter exactly the same durable Workflow continuation.

## Dynamic View types

```text
welcome
message
list
detail
forge
```

The Agent decides what semantic result should be shown; the browser renderer decides how each View looks.

This keeps presentation outside Runtime Core.

## Voice

The showcase uses the browser Web Speech API when available. It is only an input adapter: recognized text becomes the same durable message action as typed text.

## Capability acquisition

Current UAIR pieces already support:

```text
loaded Capability
connected MCP tool
installable package catalog
sandboxed acquisition
trust policy
activation
```

v0.41 adds the missing synthesis seam:

```text
@uair/forge
```

Forge is deliberately last-resort and ordered:

```text
discover
synthesize
inspect
sandbox build/test
approve
activate
register
```

It must not become:

```text
LLM writes code
→ npm install
→ import()
→ execute in host
```

## Current limitation

The demo's intent router is deterministic so the runtime behavior is reproducible.

A real model can replace the `agent.intent.interpret` Component without changing the durable turn/UI architecture.

Likewise, `@uair/forge` currently defines and verifies the package-synthesis pipeline; an actual coding model and real sandbox backend are injected implementations, not hardcoded framework behavior.


## v0.42 protocol unification

The demo no longer owns a private UI transport shape.

Every turn now waits through:

```ts
await surface({
  kind:
    view.kind,
  data: {
    turn,
    view,
    transcript
  }
});
```

The wire payload automatically carries:

```text
protocol = uair.surface/v1
```

Verified:

```text
START
  status = suspended
  view = welcome
  pending component = Surface
  protocol = uair.surface/v1

TURN 1
  input = "查一下重点客户列表"
  view = list
  items = 4
  protocol = uair.surface/v1

TURN 2
  input = click 星海科技
  view = detail
  execution remains suspended waiting for the next turn
```

The browser implementation is therefore only one renderer of the semantic Surface protocol.
