import {
  resolveSuspension
} from "@uair/core/runtime";

import type {
  Storage
} from "@uair/core/runtime";

import type {
  SuspensionCreated
} from "@uair/core/runtime";

import {
  isInteractionSpec,
  type InteractionSpec
} from "./interaction.js";

export type PendingInteraction<
  Payload = unknown
> = {
  id: string;
  executionId: string;
  workflow?: string;
  workflowVersion?: string;
  createdAt: number;
  expiresAt?: number;
  assignee: string;
  kind: string;
  data: Payload;
  title?: string;
  metadata?:
    Record<
      string,
      string |
      number |
      boolean
    >;
};

export type InteractionAuthorization =
  (
    input: {
      actor: string;
      assignee: string;
      interaction:
        PendingInteraction;
    }
  ) =>
    Promise<boolean> |
    boolean;

export class InteractionAuthorizationError
  extends Error {
  constructor(
    readonly actor: string,
    readonly assignee:
      string,
    readonly interactionId:
      string
  ) {
    super(
      `Actor "${actor}" is not allowed to resolve interaction "${interactionId}" assigned to "${assignee}".`
    );

    this.name =
      "InteractionAuthorizationError";
  }
}

function unresolved(
  suspension:
    SuspensionCreated,
  execution:
    {
      history:
        Array<{
          kind:
            string;
          suspensionId?:
            string;
        }>;
    }
) {
  return !execution.history
    .some(
      entry =>
        (
          entry.kind ===
            "suspension_resolved" ||
          entry.kind ===
            "suspension_cancelled"
        ) &&
        entry.suspensionId ===
          suspension
            .suspensionId
    );
}

export class InteractionService {
  constructor(
    private readonly storage:
      Storage,
    private readonly authorize:
      InteractionAuthorization =
        (
          input
        ) =>
          input.actor ===
          input.assignee
  ) {}

  async listPending(
    actor: string
  ) {
    const indexed =
      await this.storage
        .listSuspensions();

    const result:
      PendingInteraction[] =
      [];

    for (
      const item
      of indexed
    ) {
      const spec =
        item.suspension
          .spec;

      if (
        !isInteractionSpec(
          spec
        )
      ) {
        continue;
      }

      const execution =
        await this.storage
          .loadExecution(
            item.executionId
          );

      if (
        !execution ||
        !unresolved(
          item.suspension,
          execution
        )
      ) {
        continue;
      }

      const interaction =
        this.toPending(
          item.executionId,
          item.suspension,
          spec,
          execution.workflow,
          execution
            .workflowVersion
        );

      if (
        interaction.expiresAt !==
          undefined &&
        interaction.expiresAt <=
          Date.now()
      ) {
        continue;
      }

      if (
        await this.authorize({
          actor,
          assignee:
            interaction
              .assignee,
          interaction
        })
      ) {
        result.push(
          interaction
        );
      }
    }

    return result
      .sort(
        (
          a,
          b
        ) =>
          a.createdAt -
          b.createdAt
      );
  }

  private async load(
    interactionId:
      string
  ) {
    const indexed =
      await this.storage
        .findSuspension(
          interactionId
        );

    if (!indexed) {
      return null;
    }

    const spec =
      indexed.suspension
        .spec;

    if (
      !isInteractionSpec(
        spec
      )
    ) {
      return null;
    }

    const execution =
      await this.storage
        .loadExecution(
          indexed.executionId
        );

    if (
      !execution ||
      !unresolved(
        indexed.suspension,
        execution
      )
    ) {
      return null;
    }

    return this.toPending(
      indexed.executionId,
      indexed.suspension,
      spec,
      execution.workflow,
      execution
        .workflowVersion
    );
  }

  async getForActor(
    input: {
      interactionId:
        string;
      actor: string;
    }
  ) {
    const interaction =
      await this.load(
        input.interactionId
      );

    if (!interaction) {
      return null;
    }

    if (
      interaction.expiresAt !==
        undefined &&
      interaction.expiresAt <=
        Date.now()
    ) {
      return null;
    }

    const allowed =
      await this.authorize({
        actor:
          input.actor,
        assignee:
          interaction
            .assignee,
        interaction
      });

    if (!allowed) {
      throw new InteractionAuthorizationError(
        input.actor,
        interaction
          .assignee,
        interaction.id
      );
    }

    return interaction;
  }

  async resolve(
    input: {
      interactionId:
        string;
      actor: string;
      value: unknown;
    }
  ) {
    const interaction =
      await this.load(
        input
          .interactionId
      );

    if (!interaction) {
      /**
       * The suspension index is intentionally removed after resolution.
       * A second click from another device therefore cannot rely on the
       * index. Recover idempotently from durable History instead of
       * creating another interaction state machine.
       */
      const executions =
        await this.storage
          .listExecutions();

      const resolved =
        executions.find(
          execution =>
            execution.history
              .some(
                entry =>
                  entry.kind ===
                    "suspension_resolved" &&
                  entry.suspensionId ===
                    input.interactionId
              )
        );

      if (resolved) {
        return resolved;
      }

      return resolveSuspension(
        input
          .interactionId,
        input.value,
        this.storage,
        "manual"
      );
    }

    const allowed =
      await this.authorize({
        actor:
          input.actor,
        assignee:
          interaction
            .assignee,
        interaction
      });

    if (!allowed) {
      throw new InteractionAuthorizationError(
        input.actor,
        interaction
          .assignee,
        interaction.id
      );
    }

    if (
      interaction.expiresAt !==
        undefined &&
      interaction.expiresAt <=
        Date.now()
    ) {
      throw new Error(
        `Interaction expired: ${interaction.id}`
      );
    }

    return resolveSuspension(
      interaction.id,
      input.value,
      this.storage,
      "manual",
      input.actor
    );
  }

  private toPending(
    executionId: string,
    suspension:
      SuspensionCreated,
    spec:
      InteractionSpec,
    workflow?: string,
    workflowVersion?:
      string
  ): PendingInteraction {
    return {
      id:
        suspension
          .suspensionId,
      executionId,
      workflow,
      workflowVersion,
      createdAt:
        suspension
          .createdAt,
      expiresAt:
        suspension
          .expiresAt,
      assignee:
        spec.assignee,
      kind:
        spec.kind,
      data:
        spec.data,
      title:
        spec.title,
      metadata:
        spec.metadata
    };
  }
}
