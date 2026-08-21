import {
  component
} from "@uair/core";

export type AgentSessionRef = unknown;

export type ExternalAgentTurn<I = unknown, O = unknown> =
  | {
      type: "completed";
      output: O;
      sessionRef?: AgentSessionRef;
    }
  | {
      type: "suspended";
      /**
       * Opaque state/checkpoint/thread reference owned by the external
       * Agent framework. UAIR persists the reference, never interprets it.
       */
      sessionRef: AgentSessionRef;
      request: unknown;
    };

export type ExternalAgentRunInput<I = unknown> = {
  input?: I;
  sessionRef?: AgentSessionRef;
  resume?: unknown;
};

export interface ExternalAgentRuntime<I = unknown, O = unknown> {
  run(
    input: ExternalAgentRunInput<I> & {
      signal?: AbortSignal;
    }
  ): Promise<ExternalAgentTurn<I, O>>;
}

/**
 * Wrap an existing Agent runtime as one durable UAIR Component step.
 *
 * Important: this adapter does NOT translate the Agent's memory, prompt,
 * checkpoint, graph state or skills into UAIR History. It only persists the
 * normal Component input/output boundary, including an opaque sessionRef when
 * the external runtime needs to be continued later.
 *
 * If the Agent asks for external input, the containing UAIR Workflow should
 * suspend in a *separate* Component/Interaction, then call this component again
 * with sessionRef + resume. This preserves both runtimes' native semantics.
 */
export function externalAgent<I, O>(
  name: string,
  runtime: ExternalAgentRuntime<I, O>
) {
  return component<
    ExternalAgentRunInput<I>,
    ExternalAgentTurn<I, O>
  >(
    `external-agent:${name}`,
    async (
      input,
      ctx
    ) =>
      runtime.run({
        ...input,
        signal: ctx.signal
      })
  );
}
