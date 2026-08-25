import {
  component
} from "@uair/core";
import type {
  Component
} from "@uair/core";
import type {
  AgentAction,
  AgentActionParser,
  AgentModel,
  AgentTurnContext
} from "./agent.js";
import {
  parseAgentAction
} from "./agent.js";

export interface LlmProvider {
  complete(
    input: {
      prompt: string;
      signal?:
        AbortSignal;
    }
  ): Promise<string>;
}

export function llm(
  name: string,
  provider:
    LlmProvider
) {
  return component<
    string,
    string
  >(
    `llm:${name}`,
    async (
      prompt,
      ctx
    ) => {
      ctx.setAttribute(
        "ai.system",
        name
      );

      ctx.setAttribute(
        "ai.operation",
        "completion"
      );

      const startedAt =
        Date.now();

      const result =
        await provider.complete({
          prompt,
          signal:
            ctx.signal
        });

      ctx.addMetric(
        "ai.latency_ms",
        Date.now() -
          startedAt
      );

      return result;
    }
  );
}

/**
 * Adapt an LLM Component into an AgentModel.
 *
 * Prefer provider-native structured output when available. For other schema
 * libraries, pass parseAction to validate/transform the decoded JSON. The
 * result always passes through the built-in AgentAction validator before it
 * reaches the Agent loop.
 */
export function jsonAgentModel(
  modelComponent:
    Component<
      string,
      string
    >,
  options: {
    parseAction?:
      AgentActionParser;
  } = {}
): AgentModel {
  return {
    async decide(
      context:
        AgentTurnContext
    ): Promise<AgentAction> {
      const response =
        await modelComponent(
          JSON.stringify(
            context
          )
        );

      let decoded:
        unknown;

      try {
        decoded =
          JSON.parse(
            response
          );
      } catch (error) {
        throw new TypeError(
          "Agent model returned invalid JSON",
          {
            cause:
              error
          }
        );
      }

      return parseAgentAction(
        options.parseAction
          ? options.parseAction(
              decoded
            )
          : decoded
      );
    }
  };
}
