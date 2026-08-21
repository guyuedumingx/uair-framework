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

export interface AgentModel {
  decide(
    context:
      AgentTurnContext
  ): Promise<AgentAction>;
}

export type AgentOptions = {
  maxSteps?: number;
};

/**
 * Agent is intentionally implemented as a Component package.
 *
 * Runtime Core does not know "Agent".
 * The Agent loop itself uses normal TypeScript control flow and
 * invokes other Components for tool calls.
 */
export function agent(
  name: string,
  model: AgentModel,
  tools: AgentTool[],
  options:
    AgentOptions = {}
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
        const action =
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
