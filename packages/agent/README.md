# @uair/agent

Bounded Agent and LLM adapters built on UAIR Components.

**Status:** alpha Agent adapter API

## Install

```bash
npm install @uair/agent
```

## Codex App Server

Use `CodexAppServerRuntime` when an application should embed the OpenAI Codex
harness through its bidirectional app-server protocol. It keeps Codex's
conversation, skills, and checkpoints outside UAIR while exposing the turn
boundary as an external Agent runtime:

```ts
import {
  CodexAppServerRuntime,
  externalAgent
} from "@uair/agent";

const codex =
  externalAgent(
    "codex",
    new CodexAppServerRuntime({
      cwd: process.cwd(),
      onServerRequest: async request => {
        // Map this to the host application's approval UI.
        return { decision: "accept" };
      }
    })
  );
```

The default transport starts `codex app-server` over JSONL stdio. Remote or
embedded hosts can provide `createTransport`; UAIR does not expose an
unauthenticated WebSocket by default. Streamed app-server notifications are
available through `onEvent`, and server-initiated approvals/tool input must be
handled explicitly by the host.

## Compatibility

This package follows the UAIR alpha compatibility policy. Runtime Core has the
strongest compatibility target; Builder, sandbox, deployment and experimental
tooling interfaces may still evolve before 1.0.

Do not depend on undocumented `src/`, `internal/`, or physical storage/history
implementation details.

## Documentation

See the UAIR repository root README and `docs/` directory for the current
architecture, guides, compatibility policy, and release status.

## License

MIT.
