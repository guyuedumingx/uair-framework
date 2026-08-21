import assert from "node:assert/strict";
import {
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  spawnSync
} from "node:child_process";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

import {
  SqliteRuntimeState
} from "../packages/sqlite/dist/index.js";

const points = [
  "save-execution:after-upsert",
  "save-and-index:after-upsert",
  "save-and-index:after-index",
  "save-and-remove:after-upsert",
  "save-and-remove:after-remove"
];

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-crash-points-"
    )
  );

try {
  for (
    const point
    of points
  ) {
    const file =
      join(
        dir,
        `${point.replaceAll(
          ":",
          "-"
        )}.sqlite`
      );

    const state =
      new SqliteRuntimeState(
        file
      );

    const execution = {
      id:
        "execution-1",
      workflow:
        "crash.workflow",
      workflowVersion:
        "1",
      input: {},
      status:
        "running",
      history: [],
      revision:
        0
    };

    await state.saveExecution(
      execution
    );

    if (
      point.startsWith(
        "save-and-remove"
      )
    ) {
      const suspension = {
        kind:
          "suspension_created",
        path:
          "0",
        component:
          "Seed",
        effectId:
          "effect-seed",
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

      execution.status =
        "suspended";

      execution.history.push(
        suspension
      );

      await state
        .saveExecutionAndIndexSuspension(
          execution,
          suspension,
          execution.revision
        );
    }

    const baseline =
      await state
        .loadExecution(
          "execution-1"
        );

    const baselineSuspension =
      await state
        .findSuspension(
          "suspension-1"
        );

    state.close();

    const child =
      spawnSync(
        process.execPath,
        [
          "scripts/sqlite-crash-worker.mjs",
          file,
          point
        ],
        {
          cwd:
            process.cwd(),
          stdio:
            "ignore"
        }
      );

    assert.notEqual(
      child.status,
      0,
      `${point} worker should be killed before COMMIT`
    );

    const reopened =
      new SqliteRuntimeState(
        file
      );

    const after =
      await reopened
        .loadExecution(
          "execution-1"
        );

    const afterSuspension =
      await reopened
        .findSuspension(
          "suspension-1"
        );

    const integrity =
      reopened.db.prepare(
        "PRAGMA integrity_check"
      ).get();

    assert.equal(
      integrity.integrity_check,
      "ok",
      `${point}: SQLite integrity_check must remain ok after SIGKILL`
    );

    assert.deepEqual(
      after,
      baseline,
      `${point}: uncommitted execution mutation must roll back after process death`
    );

    assert.deepEqual(
      afterSuspension,
      baselineSuspension,
      `${point}: execution/suspension index must remain atomically consistent`
    );

    reopened.close();
  }

  console.log(
    JSON.stringify(
      {
        testedCrashPoints:
          points,
        atomicRollback:
          "PASS"
      },
      null,
      2
    )
  );

  console.log(
    "UAIR SQLite crash-at-critical-commit-points recovery: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
