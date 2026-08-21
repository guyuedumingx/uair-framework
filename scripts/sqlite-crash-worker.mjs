import {
  SqliteRuntimeState
} from "../packages/sqlite/dist/index.js";

const [
  file,
  point
] =
  process.argv.slice(2);

const state =
  new SqliteRuntimeState(
    file,
    {
      faultInjector(
        current
      ) {
        if (
          current ===
            point
        ) {
          process.kill(
            process.pid,
            "SIGKILL"
          );
        }
      }
    }
  );

const base =
  await state.loadExecution(
    "execution-1"
  );

if (!base) {
  throw new Error(
    "missing seed execution"
  );
}

if (
  point.startsWith(
    "save-execution"
  )
) {
  base.status =
    "completed";

  await state.saveExecution(
    base,
    base.revision
  );
} else if (
  point.startsWith(
    "save-and-index"
  )
) {
  base.status =
    "suspended";

  const suspension = {
    kind:
      "suspension_created",
    path:
      "0",
    component:
      "CrashPoint",
    effectId:
      "effect-1",
    generation:
      0,
    suspensionId:
      "suspension-1",
    createdAt:
      Date.now(),
    spec: {
      type:
        "interaction"
    }
  };

  base.history.push(
    suspension
  );

  await state
    .saveExecutionAndIndexSuspension(
      base,
      suspension,
      base.revision
    );
} else if (
  point.startsWith(
    "save-and-remove"
  )
) {
  base.status =
    "completed";

  base.history.push({
    kind:
      "suspension_resolved",
    suspensionId:
      "suspension-1",
    resolvedAt:
      Date.now(),
    value:
      true
  });

  await state
    .saveExecutionAndRemoveSuspension(
      base,
      "suspension-1",
      base.revision
    );
}

state.close();
