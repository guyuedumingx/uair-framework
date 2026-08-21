import type { Storage, ExternalEvent } from "@uair/core/runtime";
import type {
  UiSpec
} from "./index.js";

export type PendingUi = {
  executionId: string;
  suspensionId: string;
  component: string;
  props: unknown;
  version?: string;
  createdAt: number;
  expiresAt?: number;
};

function isUiSpec(
  value: unknown
): value is UiSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).type ===
      "ui" &&
    typeof (
      value as any
    ).component ===
      "string"
  );
}

/**
 * Protocol-neutral projection from UAIR SuspensionIndex to UI work.
 * HTTP, WebSocket, SSE, AG-UI, native apps, etc. can sit above this.
 */
export async function listPendingUi(
  storage: Storage
): Promise<PendingUi[]> {
  const waiters =
    await storage
      .listSuspensions();

  return waiters
    .filter(
      item =>
        isUiSpec(
          item.suspension
            .spec
        )
    )
    .map(
      item => {
        const spec =
          item.suspension
            .spec as UiSpec;

        return {
          executionId:
            item.executionId,
          suspensionId:
            item.suspension
              .suspensionId,
          component:
            spec.component,
          props:
            spec.props,
          version:
            spec.version,
          createdAt:
            item.suspension
              .createdAt,
          expiresAt:
            item.suspension
              .expiresAt
        };
      }
    );
}

/**
 * UI response becomes a normal external event. It can therefore use
 * the same durable Inbox, receipts, locks, and crash recovery path as
 * webhook/MCP/human events.
 */
export function uiResultEvent(
  input: {
    eventId: string;
    suspensionId: string;
    value: unknown;
  }
): ExternalEvent {
  return {
    id: input.eventId,
    type: "ui.result",
    key:
      input.suspensionId,
    value:
      input.value
  };
}
