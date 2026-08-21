import type {
  Component,
  ComponentContext,
  ComponentOptions,
  WorkflowDefinition,
  WorkflowOptions
} from "./types.js";
import {
  createExecution,
  invokeComponent,
  resumeExecution,
  runParallel,
  runRace
} from "./runtime.js";
import type { Storage } from "./storage.js";


function assertIdentity(
  kind: "workflow" |
    "component",
  id: string
) {
  if (
    id.trim() === ""
  ) {
    throw new Error(
      `${kind} id must be a non-empty stable string.`
    );
  }

  if (
    id !==
      id.trim()
  ) {
    throw new Error(
      `${kind} id may not contain leading or trailing whitespace: ${JSON.stringify(id)}`
    );
  }

  if (
    /[\u0000-\u001f\u007f]/.test(
      id
    )
  ) {
    throw new Error(
      `${kind} id may not contain control characters: ${JSON.stringify(id)}`
    );
  }
}

function assertVersion(
  version: string
) {
  if (
    version.trim() === ""
  ) {
    throw new Error(
      "workflow version must be a non-empty stable string."
    );
  }

  if (
    version !==
      version.trim()
  ) {
    throw new Error(
      `workflow version may not contain leading or trailing whitespace: ${JSON.stringify(version)}`
    );
  }

  if (
    /[\u0000-\u001f\u007f]/.test(
      version
    )
  ) {
    throw new Error(
      `workflow version may not contain control characters: ${JSON.stringify(version)}`
    );
  }
}

export function component<I, O>(
  definition: ComponentOptions & {
    id: string;
    run: (
      input: I,
      ctx: ComponentContext
    ) => Promise<O> | O;
  }
): Component<I, O>;

export function component<I, O>(
  name: string,
  handler: (
    input: I,
    ctx: ComponentContext
  ) => Promise<O> | O
): Component<I, O>;

export function component<I, O>(
  name: string,
  options: ComponentOptions,
  handler: (
    input: I,
    ctx: ComponentContext
  ) => Promise<O> | O
): Component<I, O>;

export function component<I, O>(
  nameOrDefinition:
    | string
    | (
        ComponentOptions & {
          id: string;
          run: (
            input: I,
            ctx: ComponentContext
          ) => Promise<O> | O;
        }
      ),
  optionsOrHandler?:
    | ComponentOptions
    | ((
        input: I,
        ctx: ComponentContext
      ) => Promise<O> | O),
  maybeHandler?: (
    input: I,
    ctx: ComponentContext
  ) => Promise<O> | O
): Component<I, O> {
  const objectForm =
    typeof nameOrDefinition !==
      "string";

  const id =
    objectForm
      ? nameOrDefinition.id
      : nameOrDefinition;

  assertIdentity(
    "component",
    id
  );

  const options: ComponentOptions =
    objectForm
      ? {
          retry:
            nameOrDefinition.retry,
          attributes:
            nameOrDefinition.attributes,
          resultValidForMs:
            nameOrDefinition
              .resultValidForMs
        }
      : typeof optionsOrHandler ===
          "function"
        ? {}
        : optionsOrHandler ?? {};

  const handler =
    objectForm
      ? nameOrDefinition.run
      : typeof optionsOrHandler ===
          "function"
        ? optionsOrHandler
        : maybeHandler;

  if (!handler) {
    throw new Error(
      `Missing handler for component "${id}"`
    );
  }

  const callable = async (input: I) =>
    invokeComponent(
      id,
      input,
      options,
      async (value, ctx) =>
        handler(value, ctx)
    );

  Object.defineProperties(callable, {
    kind: {
      value: "component",
      enumerable: true
    },
    id: {
      value: id,
      enumerable: true
    },
    componentName: {
      value: id,
      enumerable: true
    }
  });

  return callable as Component<I, O>;
}

export function workflow<I, O>(
  definition: WorkflowOptions & {
    id: string;
    run: (
      input: I
    ) => Promise<O>;
  }
): WorkflowDefinition<I, O>;

export function workflow<I, O>(
  name: string,
  handler: (input: I) => Promise<O>
): WorkflowDefinition<I, O>;

export function workflow<I, O>(
  name: string,
  options: {
    version?: string;
    deploymentId?: string;
    fingerprint?: string;
  },
  handler: (input: I) => Promise<O>
): WorkflowDefinition<I, O>;

export function workflow<I, O>(
  nameOrDefinition:
    | string
    | (
        WorkflowOptions & {
          id: string;
          run: (
            input: I
          ) => Promise<O>;
        }
      ),
  optionsOrHandler?:
    | WorkflowOptions
    | (
        (input: I) =>
          Promise<O>
      ),
  maybeHandler?:
    (input: I) => Promise<O>
): WorkflowDefinition<I, O> {
  const objectForm =
    typeof nameOrDefinition !==
      "string";

  const id =
    objectForm
      ? nameOrDefinition.id
      : nameOrDefinition;

  const options =
    objectForm
      ? nameOrDefinition
      : typeof optionsOrHandler ===
          "function"
        ? {}
        : optionsOrHandler ?? {};

  const handler =
    objectForm
      ? nameOrDefinition.run
      : typeof optionsOrHandler ===
          "function"
        ? optionsOrHandler
        : maybeHandler!;

  assertIdentity(
    "workflow",
    id
  );

  const version =
    options.version ??
    "1";

  assertVersion(
    version
  );

  return {
    kind: "workflow",
    id,
    name: id,
    version,
    deploymentId:
      options.deploymentId,
    fingerprint:
      options.fingerprint,
    handler
  };
}

export async function parallel<
  T extends readonly unknown[]
>(
  branches: {
    [K in keyof T]:
      () => Promise<T[K]> | T[K]
  }
): Promise<T> {
  const values = await runParallel(
    Array.from(branches) as Array<
      () => Promise<unknown> | unknown
    >
  );

  return values as unknown as T;
}

export async function race<T>(
  branches: Array<
    () => Promise<T> | T
  >
): Promise<T> {
  return runRace(branches);
}

export async function run<I, O>(
  workflowDef:
    WorkflowDefinition<I, O>,
  input: I,
  storage: Storage
) {
  return createExecution(
    workflowDef,
    input,
    storage
  );
}

export async function resume<I, O>(
  workflowDef:
    WorkflowDefinition<I, O>,
  executionId: string,
  storage: Storage
) {
  return resumeExecution(
    workflowDef,
    executionId,
    storage
  );
}
