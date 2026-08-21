import type {
  Execution,
  SuspensionCreated
} from "./types.js";
import type { Storage } from "./storage.js";
import {
  resolveSuspension
} from "./runtime.js";

export type DueSuspension = {
  execution: Execution;
  suspension: SuspensionCreated;
};

export async function findDueTimers(
  storage: Storage,
  now = Date.now()
): Promise<DueSuspension[]> {
  const indexed =
    await storage.listSuspensions();

  const due: DueSuspension[] = [];

  for (const item of indexed) {
    const suspension =
      item.suspension;

    if (
      typeof suspension.spec !==
        "object" ||
      suspension.spec === null ||
      (suspension.spec as any).type !==
        "timer"
    ) {
      continue;
    }

    const deadline =
      (suspension.spec as any)
        .deadline;

    if (
      typeof deadline !== "number" ||
      deadline > now
    ) {
      continue;
    }

    const execution =
      await storage.loadExecution(
        item.executionId
      );

    if (
      execution &&
      execution.status ===
        "suspended"
    ) {
      due.push({
        execution,
        suspension
      });
    }
  }

  return due;
}

export async function resolveDueTimers(
  storage: Storage,
  now = Date.now()
): Promise<Execution[]> {
  const due =
    await findDueTimers(
      storage,
      now
    );

  const touched:
    Execution[] = [];

  for (const item of due) {
    const value =
      typeof item.suspension.spec ===
        "object" &&
      item.suspension.spec !== null
        ? (item.suspension.spec as any)
            .value
        : undefined;

    const execution =
      await resolveSuspension(
        item.suspension.suspensionId,
        value,
        storage
      );

    touched.push(execution);
  }

  return touched;
}
