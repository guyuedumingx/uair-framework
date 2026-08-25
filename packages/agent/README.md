# @uair/agent

Bounded Agent and LLM adapters built on UAIR Components.

**Status:** alpha Agent adapter API

## Install

```bash
npm install @uair/agent
```

Provider-specific implementations, including OpenAI Codex app-server support,
live in <https://github.com/guyuedumingx/uair-integrations>.

## Reliable model actions

Treat model output as untrusted data. `agent()` always validates the returned
action before selecting or executing a tool:

```ts
import {
  agent,
  jsonAgentModel
} from "@uair/agent";

const supportAgent = agent(
  "support",
  jsonAgentModel(modelComponent, {
    parseAction(value) {
      // Use Zod, Valibot, ArkType or another runtime schema here.
      return actionSchema.parse(value);
    }
  }),
  tools
);
```

`jsonAgentModel()` rejects malformed JSON and every parsed result passes through
UAIR's provider-neutral `AgentAction` validator. Provider-native structured
output is preferred when available.

`AgentModel.decide()` may use ordinary TypeScript for deterministic decisions,
but nondeterministic model/provider I/O must run through a UAIR Component. This
lets Runtime History replay the recorded model result instead of issuing the
provider request again after a crash.

Use `parseAgentAction(value)` directly when writing a custom adapter. A custom
`AgentOptions.parseAction` can transform provider-specific output, but cannot
bypass the built-in final validation. Custom parsers must be deterministic and
side-effect-free because Runtime replay may execute them again.

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
