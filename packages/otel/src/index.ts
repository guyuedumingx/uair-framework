import type { Execution } from "@uair/core";
import type { HistoryEntry } from "@uair/core/runtime";

export type SpanLike = {
  name: string;
  startTime?: number;
  endTime?: number;
  status:
    | "ok"
    | "error"
    | "waiting";
  attributes:
    Record<
      string,
      string | number | boolean
    >;
  metrics:
    Record<
      string,
      number
    >;
};

export type SpanSanitizer = {
  attribute?:
    (
      key: string,
      value:
        string |
        number |
        boolean
    ) =>
      string |
      number |
      boolean;
};

export function executionToSpans(
  execution: Execution,
  sanitizer:
    SpanSanitizer =
      {}
): SpanLike[] {
  const spans:
    SpanLike[] = [];

  const attributes =
    (
      input:
        Record<
          string,
          string |
          number |
          boolean
        >
    ) =>
      Object.fromEntries(
        Object.entries(
          input
        ).map(
          (
            [
              key,
              value
            ]
          ) => [
            key,
            sanitizer
              .attribute?.(
                key,
                value
              ) ??
              value
          ]
        )
      ) as
        Record<
          string,
          string |
          number |
          boolean
        >;

  for (const entry of execution.history) {
    if (
      entry.kind ===
        "effect_completed"
    ) {
      spans.push({
        name:
          entry.component,
        startTime:
          entry.startedAt,
        endTime:
          entry.completedAt,
        status:
          "ok",
        attributes: attributes({
          "uair.execution.id":
            execution.id,
          "uair.workflow":
            execution.workflow,
          "uair.path":
            entry.path,
          "uair.effect.id":
            entry.effectId,
          "uair.generation":
            entry.generation,
          ...(entry.attributes ?? {})
        }),
        metrics: {
          ...(entry.metrics ?? {})
        }
      });

      continue;
    }

    if (
      entry.kind ===
        "effect_attempt_failed"
    ) {
      spans.push({
        name:
          `${entry.component}.attempt`,
        startTime:
          entry.attemptStartedAt,
        endTime:
          entry.failedAt,
        status:
          "error",
        attributes: attributes({
          "uair.execution.id":
            execution.id,
          "uair.workflow":
            execution.workflow,
          "uair.path":
            entry.path,
          "uair.effect.id":
            entry.effectId,
          "uair.generation":
            entry.generation,
          "uair.attempt":
            entry.attempt,
          "error.type":
            entry.error.name,
          "error.message":
            entry.error.message,
          ...(entry.attributes ?? {})
        }),
        metrics: {
          ...(entry.metrics ?? {})
        }
      });

      continue;
    }

    if (
      entry.kind ===
        "suspension_created"
    ) {
      const resolution =
        execution.history.find(
          candidate =>
            candidate.kind ===
              "suspension_resolved" &&
            candidate.suspensionId ===
              entry.suspensionId
        ) as any;

      spans.push({
        name:
          entry.component,
        startTime:
          entry.createdAt,
        endTime:
          resolution
            ?.resolvedAt,
        status:
          resolution
            ? "ok"
            : "waiting",
        attributes: attributes({
          "uair.execution.id":
            execution.id,
          "uair.workflow":
            execution.workflow,
          "uair.path":
            entry.path,
          "uair.effect.id":
            entry.effectId,
          "uair.suspension.id":
            entry.suspensionId,
          "uair.generation":
            entry.generation,
          ...(entry.attributes ?? {})
        }),
        metrics: {
          ...(entry.metrics ?? {})
        }
      });
    }
  }

  return spans;
}

export interface SpanExporter {
  export(
    spans:
      SpanLike[]
  ): Promise<void>;
}

export async function exportExecution(
  execution: Execution,
  exporter:
    SpanExporter,
  sanitizer:
    SpanSanitizer =
      {}
) {
  await exporter.export(
    executionToSpans(
      execution,
      sanitizer
    )
  );
}
