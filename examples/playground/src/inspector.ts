import type { Execution } from "@uair/core";
import type { HistoryEntry } from "@uair/core/runtime";

export type InspectorAttempt = {
  attempt: number;
  attemptStartedAt?: number;
  failedAt: number;
  durationMs?: number;
  error: unknown;
};

export type InspectorGeneration = {
  generation: number;
  status:
    | "completed"
    | "waiting"
    | "resolved"
    | "failed";
  effectId?: string;
  suspensionId?: string;
  input?: unknown;
  output?: unknown;
  attributes?:
    Record<
      string,
      string | number | boolean
    >;
  metrics?:
    Record<
      string,
      number
    >;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  attempts: InspectorAttempt[];
};

export type InspectorNode = {
  id: string;
  path: string;
  component: string;
  kind:
    | "effect"
    | "suspension";
  status:
    | "completed"
    | "waiting"
    | "resolved"
    | "failed";
  replayed: boolean;
  currentGeneration: number;
  generations:
    InspectorGeneration[];
  children:
    InspectorNode[];
};

function parentPath(
  path: string
) {
  const parts =
    path.split(".");

  if (parts.length <= 1) {
    return "";
  }

  return parts
    .slice(0, -1)
    .join(".");
}

function findResolution(
  history: HistoryEntry[],
  suspensionId: string
) {
  return history.find(
    entry =>
      entry.kind ===
        "suspension_resolved" &&
      entry.suspensionId ===
        suspensionId
  ) as any;
}

function sortByPath(
  a: InspectorNode,
  b: InspectorNode
) {
  const aa =
    a.path
      .split(".")
      .map(Number);

  const bb =
    b.path
      .split(".")
      .map(Number);

  const length =
    Math.max(
      aa.length,
      bb.length
    );

  for (
    let i = 0;
    i < length;
    i += 1
  ) {
    const av =
      aa[i] ?? -1;
    const bv =
      bb[i] ?? -1;

    if (av !== bv) {
      return av - bv;
    }
  }

  return 0;
}

export function buildExecutionTree(
  execution: Execution
) {
  const managed =
    execution.history.filter(
      entry =>
        entry.kind ===
          "effect_completed" ||
        entry.kind ===
          "suspension_created"
    ) as any[];

  const failures =
    execution.history.filter(
      entry =>
        entry.kind ===
          "effect_attempt_failed"
    ) as any[];

  const grouped =
    new Map<
      string,
      any[]
    >();

  for (const entry of managed) {
    const list =
      grouped.get(
        entry.path
      ) ?? [];

    list.push(entry);

    grouped.set(
      entry.path,
      list
    );
  }

  const byPath =
    new Map<
      string,
      InspectorNode
    >();

  for (
    const [path, entries]
    of grouped
  ) {
    entries.sort(
      (a, b) =>
        a.generation -
        b.generation
    );

    const generations:
      InspectorGeneration[] =
        entries.map(
          entry => {
            const attempts =
              failures
                .filter(
                  failure =>
                    failure.path ===
                      entry.path &&
                    failure.generation ===
                      entry.generation
                )
                .map(
                  failure => ({
                    attempt:
                      failure.attempt,
                    attemptStartedAt:
                      failure.attemptStartedAt,
                    failedAt:
                      failure.failedAt,
                    durationMs:
                      failure.attemptStartedAt ===
                        undefined
                        ? undefined
                        : failure.failedAt -
                          failure.attemptStartedAt,
                    error:
                      failure.error
                  })
                );

            if (
              entry.kind ===
                "effect_completed"
            ) {
              return {
                generation:
                  entry.generation,
                status:
                  "completed" as const,
                effectId:
                  entry.effectId,
                input:
                  entry.input,
                output:
                  entry.output,
                attributes:
                  entry.attributes,
                metrics:
                  entry.metrics,
                startedAt:
                  entry.startedAt,
                completedAt:
                  entry.completedAt,
                durationMs:
                  entry.startedAt ===
                    undefined
                    ? undefined
                    : entry.completedAt -
                      entry.startedAt,
                attempts
              };
            }

            const resolution =
              findResolution(
                execution.history,
                entry.suspensionId
              );

            return {
              generation:
                entry.generation,
              status:
                resolution
                  ? "resolved" as const
                  : "waiting" as const,
              effectId:
                entry.effectId,
              suspensionId:
                entry.suspensionId,
              input:
                entry.input,
              output:
                resolution?.value,
              attributes:
                entry.attributes,
              metrics:
                entry.metrics,
              startedAt:
                entry.createdAt,
              completedAt:
                resolution
                  ?.resolvedAt,
              durationMs:
                resolution
                  ? resolution
                      .resolvedAt -
                    entry.createdAt
                  : undefined,
              attempts
            };
          }
        );

    const current =
      generations[
        generations.length - 1
      ];

    byPath.set(
      path,
      {
        id: path,
        path,
        component:
          entries[
            entries.length - 1
          ].component,
        kind:
          entries[
            entries.length - 1
          ].kind ===
            "suspension_created"
            ? "suspension"
            : "effect",
        status:
          current.status,
        replayed:
          generations.length > 1,
        currentGeneration:
          current.generation,
        generations,
        children: []
      }
    );
  }

  const roots:
    InspectorNode[] = [];

  const nodes =
    [...byPath.values()]
      .sort(sortByPath);

  for (const node of nodes) {
    const parent =
      byPath.get(
        parentPath(
          node.path
        )
      );

    if (parent) {
      parent.children.push(
        node
      );
    } else {
      roots.push(node);
    }
  }

  return {
    workflow:
      execution.workflow,
    status:
      execution.status,
    roots
  };
}
