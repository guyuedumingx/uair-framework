import {
  component
} from "@uair/core";
import type {
  Component
} from "@uair/core";
import type {
  AgentAction,
  AgentModel,
  AgentTurnContext
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
 * Minimal adapter showing that an AgentModel can itself be powered by
 * an LLM Component. A real implementation would use structured output
 * / JSON schema rather than free-form JSON parsing.
 */
export function jsonAgentModel(
  modelComponent:
    Component<
      string,
      string
    >
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

      return JSON.parse(
        response
      ) as AgentAction;
    }
  };
}
