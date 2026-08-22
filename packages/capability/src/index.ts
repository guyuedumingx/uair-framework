import type {
  Component
} from "@uair/core";

/** Provider-neutral executable tool shape. */
export type CapabilityTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  run: Component<
    Record<string, unknown> | undefined,
    unknown
  >;
};

export type CapabilityKind =
  | "tool"
  | "ui"
  | "workflow"
  | "service";

export type Capability = {
  id: string;
  kind: CapabilityKind;
  description?: string;
  tags?: string[];
  inputSchema?: unknown;
  invoke?:
    Component<
      Record<
        string,
        unknown
      > | undefined,
      unknown
    >;
  metadata?: Record<
    string,
    unknown
  >;
};

export type CapabilityPredicate =
  (
    capability: Capability
  ) => boolean;

export class CapabilitySet {
  private readonly byId =
    new Map<
      string,
      Capability
    >();

  constructor(
    capabilities:
      Capability[] = []
  ) {
    for (
      const capability
      of capabilities
    ) {
      this.add(
        capability
      );
    }
  }

  add(
    capability: Capability
  ) {
    this.byId.set(
      capability.id,
      capability
    );

    return this;
  }

  get(
    id: string
  ) {
    return this.byId.get(id);
  }

  has(
    id: string
  ) {
    return this.byId.has(id);
  }

  list() {
    return [
      ...this.byId.values()
    ];
  }

  filter(
    predicate:
      CapabilityPredicate
  ) {
    return new CapabilitySet(
      this.list().filter(
        predicate
      )
    );
  }

  merge(
    ...sets:
      CapabilitySet[]
  ) {
    const merged =
      new CapabilitySet(
        this.list()
      );

    for (
      const set of sets
    ) {
      for (
        const capability
        of set.list()
      ) {
        merged.add(
          capability
        );
      }
    }

    return merged;
  }

  toAgentTools():
    CapabilityTool[] {
    return this.list()
      .filter(
        capability =>
          capability.kind ===
            "tool" &&
          !!capability.invoke
      )
      .map(
        capability => ({
          name:
            capability.id,
          description:
            capability.description,
          inputSchema:
            capability.inputSchema,
          run:
            capability.invoke!
        })
      );
  }
}

export function capability(
  input: Capability
) {
  return input;
}
