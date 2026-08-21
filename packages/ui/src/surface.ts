import {
  component
} from "@uair/core";
import type {
  Component
} from "@uair/core";
import {
  displayUi
} from "./ui.js";

export type SurfaceSpec<
  Data = unknown
> = {
  /**
   * Semantic renderer key.
   *
   * Examples:
   *   "message"
   *   "list"
   *   "customer.detail"
   *   "approval"
   *
   * UAIR does not define the visual component tree behind this key.
   */
  kind: string;

  /**
   * Renderer-owned serializable payload.
   */
  data: Data;

  title?: string;
  version?: string;

  /**
   * Optional renderer hints. These are intentionally advisory;
   * durable control flow must never depend on them.
   */
  hints?: {
    density?:
      | "compact"
      | "comfortable";
    preferredPresentation?:
      | "inline"
      | "panel"
      | "modal"
      | "fullscreen";
  };
};

export type SurfaceDocument<
  Data = unknown
> =
  SurfaceSpec<Data> & {
    protocol:
      "uair.surface/v1";
  };

export function toSurfaceDocument<
  Data = unknown
>(
  spec:
    SurfaceSpec<Data>
): SurfaceDocument<Data> {
  return {
    ...spec,
    protocol:
      "uair.surface/v1"
  };
}

export function isSurfaceDocument(
  value: unknown
): value is
  SurfaceDocument {
  return (
    typeof value ===
      "object" &&
    value !== null &&
    (
      value as any
    ).protocol ===
      "uair.surface/v1" &&
    typeof (
      value as any
    ).kind ===
      "string" &&
    "data" in
      (
        value as any
      )
  );
}

export type SurfaceAction<
  Value = unknown
> = {
  type: string;
  value?: Value;
  id?: string;
  label?: string;
  metadata?: Record<
    string,
    unknown
  >;
};

export type InputRequest = {
  prompt: string;
  placeholder?: string;
  initialValue?: string;
  modes?: Array<
    | "text"
    | "voice"
  >;
  submitLabel?: string;
};

export type InputResult = {
  value: string;
  mode?:
    | "text"
    | "voice";
};

export type ChoiceItem<
  Value = string
> = {
  id: string;
  label: string;
  description?: string;
  value: Value;
  metadata?: Record<
    string,
    unknown
  >;
};

export type ChooseRequest<
  Value = string
> = {
  title?: string;
  prompt?: string;
  items:
    ChoiceItem<Value>[];
  multiple?: boolean;
};

export type ChooseResult<
  Value = string
> = {
  selected:
    Value[];
  ids: string[];
};

const surfaceComponent:
  Component<
    SurfaceSpec,
    SurfaceAction
  > =
  component({
    id:
      "ui.surface",

    async run(
      spec,
      ctx
    ) {
      return ctx.suspend({
        type:
          "ui",
        component:
          "Surface",
        props:
          toSurfaceDocument(
            spec
          ),
        mode:
          "blocking",
        version:
          spec.version
      });
    }
  });

const inputComponent:
  Component<
    InputRequest,
    InputResult
  > =
  component({
    id:
      "ui.input",

    async run(
      request,
      ctx
    ) {
      return ctx.suspend({
        type:
          "ui",
        component:
          "Input",
        props:
          request,
        mode:
          "blocking",
        version:
          "1"
      });
    }
  });

const chooseComponent:
  Component<
    ChooseRequest<any>,
    ChooseResult<any>
  > =
  component({
    id:
      "ui.choose",

    async run(
      request,
      ctx
    ) {
      return ctx.suspend({
        type:
          "ui",
        component:
          "Choose",
        props:
          request,
        mode:
          "blocking",
        version:
          "1"
      });
    }
  });

/**
 * Generic blocking semantic surface.
 *
 * The returned action is renderer-neutral and can originate from:
 * web click, keyboard, mobile native UI, voice adapter, etc.
 */
export function surface<
  Data = unknown,
  Value = unknown
>(
  spec:
    SurfaceSpec<Data>
): Promise<
  SurfaceAction<Value>
> {
  return surfaceComponent(
    spec
  ) as Promise<
    SurfaceAction<Value>
  >;
}

/**
 * Blocking text/voice input sugar.
 *
 * Stable durable identity stays internal as `ui.input`.
 */
export function input(
  request:
    InputRequest
) {
  return inputComponent(
    request
  );
}

/**
 * Blocking selection sugar.
 */
export async function choose<
  Value = string
>(
  request:
    ChooseRequest<Value>
): Promise<
  ChooseResult<Value>
> {
  return chooseComponent(
    request
  );
}

/**
 * Non-blocking semantic presentation.
 *
 * It is still only an adapter message. Showing something must not
 * secretly suspend or alter Workflow control flow.
 */
export function present<
  Data = unknown
>(
  spec:
    SurfaceSpec<Data>
) {
  return displayUi(
    "Surface",
    toSurfaceDocument(
      spec
    ),
    {
      version:
        spec.version
    }
  );
}

export type SurfaceRenderer<
  Spec extends
    SurfaceSpec = SurfaceSpec,
  Output = unknown
> = (
  spec: Spec
) => Output;

export class SurfaceRendererRegistry<
  Output = unknown
> {
  private readonly renderers =
    new Map<
      string,
      SurfaceRenderer<
        any,
        Output
      >
    >();

  register<
    Spec extends
      SurfaceSpec
  >(
    kind: Spec["kind"],
    renderer:
      SurfaceRenderer<
        Spec,
        Output
      >
  ) {
    this.renderers.set(
      kind,
      renderer
    );

    return this;
  }

  has(
    kind: string
  ) {
    return this.renderers
      .has(kind);
  }

  render(
    spec:
      SurfaceSpec
  ): Output {
    const renderer =
      this.renderers.get(
        spec.kind
      );

    if (!renderer) {
      throw new Error(
        `No Surface renderer registered for kind "${spec.kind}"`
      );
    }

    return renderer(
      spec
    );
  }
}
