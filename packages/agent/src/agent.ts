import {
  component
} from "@uair/core";
import type {
  Component
} from "@uair/core";

export type AgentTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  /**
   * Optional runtime parser/validator for model-generated arguments.
   * Integrates with Zod/Valibot/ArkType/etc without making UAIR own a schema DSL.
   */
  parseArgs?: (
    value: unknown
  ) =>
    | Record<
        string,
        unknown
      >
    | undefined;
  run:
    Component<
      Record<
        string,
        unknown
      > | undefined,
      unknown
    >;
};

export type AgentAction =
  | {
      type: "tool";
      tool: string;
      args?:
        Record<
          string,
          unknown
        >;
    }
  | {
      type: "final";
      value: unknown;
    };

export type AgentActionParser<
  Input = unknown
> = (
  value: Input
) => AgentAction;

const isRecord = (
  value: unknown
): value is Record<
  string,
  unknown
> =>
  typeof value ===
    "object" &&
  value !== null &&
  !Array.isArray(
    value
  );

/**
 * Validate and normalize an untrusted model decision.
 *
 * Model output is data, even when AgentModel is statically typed. This parser
 * keeps JavaScript callers, provider adapters and unsafe casts from reaching
 * tool execution with a malformed action.
 */
export const parseAgentAction:
  AgentActionParser =
  value => {
    if (!isRecord(value)) {
      throw new TypeError(
        "Agent action must be an object"
      );
    }

    if (
      value.type ===
        "tool"
    ) {
      if (
        typeof value.tool !==
          "string" ||
        value.tool.length ===
          0
      ) {
        throw new TypeError(
          "Agent tool action.tool must be a non-empty string"
        );
      }

      if (
        value.args !==
          undefined &&
        !isRecord(
          value.args
        )
      ) {
        throw new TypeError(
          "Agent tool action.args must be an object when provided"
        );
      }

      return {
        type:
          "tool",
        tool:
          value.tool,
        ...(
          value.args ===
            undefined
            ? {}
            : {
                args:
                  value.args
              }
        )
      };
    }

    if (
      value.type ===
        "final"
    ) {
      if (
        !("value" in value)
      ) {
        throw new TypeError(
          "Agent final action must include value"
        );
      }

      return {
        type:
          "final",
        value:
          value.value
      };
    }

    throw new TypeError(
      'Agent action.type must be "tool" or "final"'
    );
  };

export type AgentTurnContext = {
  input: unknown;
  steps: Array<{
    action:
      AgentAction;
    result?: unknown;
  }>;
  tools:
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>;
};

export interface AgentModel<
  Decision = AgentAction
> {
  /**
   * Decide the next action.
   *
   * Any nondeterministic provider I/O used here must be performed through a
   * UAIR Component. jsonAgentModel() follows that contract by accepting an LLM
   * Component rather than a raw provider callback.
   */
  decide(
    context:
      AgentTurnContext
  ): Promise<Decision>;
}

export type AgentOptions<
  Decision = AgentAction
> = {
  maxSteps?: number;
  /**
   * Optional integration with Zod/Valibot/ArkType/etc. The returned value is
   * still checked by parseAgentAction(), so custom parsers cannot bypass the
   * public AgentAction contract. The parser must be deterministic and free of
   * external side effects because it may run again during replay.
   */
  parseAction?:
    AgentActionParser<
      Decision
    >;
};

/**
 * Agent is intentionally implemented as a Component package.
 *
 * Runtime Core does not know "Agent".
 * The Agent loop itself uses normal TypeScript control flow and
 * invokes other Components for tool calls.
 */
export function agent<
  Decision = AgentAction
>(
  name: string,
  model:
    AgentModel<
      Decision
    >,
  tools: AgentTool[],
  options:
    AgentOptions<
      Decision
    > = {}
) {
  const toolMap =
    new Map(
      tools.map(
        tool => [
          tool.name,
          tool
        ]
      )
    );

  const maxSteps =
    options.maxSteps ??
    20;

  return component<
    unknown,
    unknown
  >(
    `agent:${name}`,
    async input => {
      const steps:
        AgentTurnContext[
          "steps"
        ] = [];

      for (
        let index = 0;
        index < maxSteps;
        index += 1
      ) {
        const candidate =
          await model.decide({
            input,
            steps,
            tools:
              tools.map(
                tool => ({
                  name:
                    tool.name,
                  description:
                    tool.description,
                  inputSchema:
                    tool.inputSchema
                })
              )
          });

        const action =
          parseAgentAction(
            options.parseAction
              ? options.parseAction(
                  candidate
                )
              : candidate
          );

        if (
          action.type ===
          "final"
        ) {
          steps.push({
            action
          });

          return action.value;
        }

        const tool =
          toolMap.get(
            action.tool
          );

        if (!tool) {
          throw new Error(
            `Agent selected unknown tool "${action.tool}"`
          );
        }

        const parsedArgs =
          tool.parseArgs
            ? tool.parseArgs(
                action.args
              )
            : action.args;

        const result =
          await tool.run(
            parsedArgs
          );

        steps.push({
          action,
          result
        });
      }

      throw new Error(
        `Agent "${name}" exceeded maxSteps=${maxSteps}`
      );
    }
  );
}

export function asAgentTool(
  run:
    Component<
      Record<
        string,
        unknown
      > | undefined,
      unknown
    >,
  options?: {
    name?: string;
    description?: string;
    inputSchema?: unknown;
    parseArgs?: (
      value: unknown
    ) =>
      | Record<
          string,
          unknown
        >
      | undefined;
  }
): AgentTool;

export function asAgentTool(
  name: string,
  run:
    Component<
      Record<
        string,
        unknown
      > | undefined,
      unknown
    >,
  options?: {
    description?: string;
    inputSchema?: unknown;
    parseArgs?: (
      value: unknown
    ) =>
      | Record<
          string,
          unknown
        >
      | undefined;
  }
): AgentTool;

export function asAgentTool(
  nameOrRun:
    | string
    | Component<
        Record<
          string,
          unknown
        > | undefined,
        unknown
      >,
  runOrOptions?:
    | Component<
        Record<
          string,
          unknown
        > | undefined,
        unknown
      >
    | {
        name?: string;
        description?: string;
        inputSchema?: unknown;
        parseArgs?: (
          value: unknown
        ) =>
          | Record<
              string,
              unknown
            >
          | undefined;
      },
  maybeOptions: {
    description?: string;
    inputSchema?: unknown;
    parseArgs?: (
      value: unknown
    ) =>
      | Record<
          string,
          unknown
        >
      | undefined;
  } = {}
): AgentTool {
  if (
    typeof nameOrRun !==
      "string"
  ) {
    const options =
      (
        runOrOptions &&
        typeof runOrOptions ===
          "object" &&
        !(
          "kind" in
          runOrOptions
        )
      )
        ? runOrOptions
        : {};

    return {
      name:
        options.name ??
        nameOrRun.id,
      run:
        nameOrRun,
      description:
        options.description,
      inputSchema:
        options.inputSchema,
      parseArgs:
        options.parseArgs
    };
  }

  const run =
    runOrOptions as
      Component<
        Record<
          string,
          unknown
        > | undefined,
        unknown
      >;

  return {
    name:
      nameOrRun,
    run,
    description:
      maybeOptions.description,
    inputSchema:
      maybeOptions.inputSchema,
    parseArgs:
      maybeOptions.parseArgs
  };
}
