import type {
  SuspensionCreated
} from "./types.js";
import type { Storage } from "./storage.js";

export type ExternalEvent = {
  id: string;
  type: string;
  key?: string;
  value: unknown;
};

export type EventWaiter = {
  executionId: string;
  suspension: SuspensionCreated;
};

function matchesEvent(
  spec: unknown,
  event: ExternalEvent
): boolean {
  if (
    typeof spec !== "object" ||
    spec === null
  ) {
    return false;
  }

  const value = spec as any;

  if (value.type !== "event") {
    return false;
  }

  if (
    value.eventType !== event.type
  ) {
    return false;
  }

  if (
    value.key !== undefined &&
    value.key !== event.key
  ) {
    return false;
  }

  return true;
}

export async function findEventWaiters(
  storage: Storage,
  event: ExternalEvent
): Promise<EventWaiter[]> {
  const indexed =
    await storage.listSuspensions();

  return indexed.filter(
    item => {
      if (
        event.type ===
          "ui.result" &&
        event.key ===
          item.suspension
            .suspensionId
      ) {
        const spec =
          item.suspension
            .spec as any;

        return (
          typeof spec ===
            "object" &&
          spec !== null &&
          spec.type === "ui"
        );
      }

      return matchesEvent(
        item.suspension.spec,
        event
      );
    }
  );
}
