import {
  component
} from "@uair/core";
import type {
  ComponentOptions
} from "@uair/core";

export type UiMode =
  | "blocking"
  | "display";

export type UiSpec<Props = unknown> = {
  type: "ui";
  component: string;
  props: Props;
  mode: UiMode;
  version?: string;
};

export type UiOptions = {
  version?: string;
  component?:
    ComponentOptions;
};

/**
 * Blocking UI is deliberately just a Component suspension.
 *
 * The runtime does not know React, Vue, AG-UI, HTML, or native UI.
 * An external adapter renders the suspension spec and later resolves
 * the suspension with the user's result.
 */
/**
 * @deprecated Prefer `surface()`, `input()` or `choose()` from `@uair/ui`.
 * Kept for v0.x compatibility and low-level renderer adapters.
 */
export function ui<
  Props,
  Result
>(
  name: string,
  options:
    UiOptions = {}
) {
  return component<
    Props,
    Result
  >(
    `ui:${name}`,
    options.component ?? {},
    async (
      props,
      ctx
    ) =>
      ctx.suspend({
        type: "ui",
        component: name,
        props,
        mode: "blocking",
        version:
          options.version
      } satisfies UiSpec<Props>)
  );
}

/**
 * Non-blocking UI is an event emitted by an adapter, not a suspension.
 * Keeping it separate prevents "show something" from secretly changing
 * workflow control flow.
 */
export type UiDisplayMessage<
  Props = unknown
> = {
  type: "ui.display";
  component: string;
  props: Props;
  version?: string;
};

/**
 * @deprecated Prefer `present()` from `@uair/ui`.
 * Kept for v0.x compatibility and low-level renderer adapters.
 */
export function displayUi<
  Props
>(
  name: string,
  props: Props,
  options: {
    version?: string;
  } = {}
): UiDisplayMessage<Props> {
  return {
    type: "ui.display",
    component: name,
    props,
    version:
      options.version
  };
}
