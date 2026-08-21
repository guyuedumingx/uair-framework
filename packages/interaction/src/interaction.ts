import {
  component
} from "@uair/core";

import type {
  ComponentOptions
} from "@uair/core";

export type InteractionSpec<
  Payload = unknown
> = {
  type:
    "interaction";

  /**
   * Opaque assignee identity understood by the host application.
   * Examples: "user:manager_li", "employee:1001".
   *
   * UAIR intentionally does not define an enterprise identity model.
   */
  assignee: string;

  /**
   * Semantic renderer/interaction kind.
   * Example: "hr.leave.manager-approval".
   */
  kind: string;

  data: Payload;

  /**
   * Optional presentation hint. Runtime does not interpret this.
   */
  title?: string;

  /**
   * Optional business metadata for host-side routing/audit.
   */
  metadata?:
    Record<
      string,
      string |
      number |
      boolean
    >;
};

export type InteractionOptions = {
  component?:
    ComponentOptions;

  /**
   * Lifetime of the unresolved request.
   */
  expiresInMs?: number;

  /**
   * Lifetime of the resolved answer when Workflow history is replayed.
   */
  resultValidForMs?: number;
};

/**
 * A human interaction is deliberately only a typed Suspension.
 *
 * No user directory, notification channel, inbox database, or RBAC
 * subsystem is introduced into Runtime Core.
 */
export function interaction<
  Payload,
  Result
>(
  id: string,
  options:
    InteractionOptions = {}
) {
  return component<
    {
      assignee: string;
      data: Payload;
      title?: string;
      metadata?:
        Record<
          string,
          string |
          number |
          boolean
        >;
    },
    Result
  >(
    `interaction:${id}`,
    options.component ??
      {},
    async (
      input,
      ctx
    ) =>
      ctx.suspend<Result>(
        {
          type:
            "interaction",
          assignee:
            input.assignee,
          kind:
            id,
          data:
            input.data,
          title:
            input.title,
          metadata:
            input.metadata
        } satisfies
          InteractionSpec<
            Payload
          >,
        {
          expiresInMs:
            options.expiresInMs,
          resultValidForMs:
            options
              .resultValidForMs
        }
      )
  );
}

export function isInteractionSpec(
  value: unknown
): value is
  InteractionSpec {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const spec =
    value as
      Partial<
        InteractionSpec
      >;

  return (
    spec.type ===
      "interaction" &&
    typeof spec.assignee ===
      "string" &&
    typeof spec.kind ===
      "string"
  );
}
