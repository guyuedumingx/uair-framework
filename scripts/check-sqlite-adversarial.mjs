import assert from "node:assert/strict";
import {
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

import {
  StorageConflictError
} from "../packages/core/dist/runtime-api.js";

import {
  SqliteRuntimeState
} from "../packages/sqlite/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-sqlite-race-"
    )
  );

try {
  const file =
    join(
      dir,
      "runtime.sqlite"
    );

  const seed =
    new SqliteRuntimeState(
      file
    );

  const execution = {
    id:
      "execution-1",
    workflow:
      "race.workflow",
    workflowVersion:
      "1",
    input: {},
    status:
      "running",
    history: [],
    revision:
      0
  };

  await seed.saveExecution(
    execution
  );

  assert.equal(
    execution.revision,
    1
  );

  seed.close();

  const connections =
    Array.from(
      {
        length:
          12
      },
      () =>
        new SqliteRuntimeState(
          file
        )
    );

  try {
    const copies =
      await Promise.all(
        connections.map(
          state =>
            state.loadExecution(
              execution.id
            )
        )
      );

    const results =
      await Promise.allSettled(
        connections.map(
          async (
            state,
            index
          ) => {
            const copy =
              structuredClone(
                copies[index]
              );

            copy.result = {
              winner:
                index
            };

            copy.status =
              "completed";

            await state.saveExecution(
              copy,
              1
            );

            return index;
          }
        )
      );

    const fulfilled =
      results.filter(
        result =>
          result.status ===
          "fulfilled"
      );

    const rejected =
      results.filter(
        result =>
          result.status ===
          "rejected"
      );

    assert.equal(
      fulfilled.length,
      1,
      "exactly one optimistic writer must win"
    );

    assert.equal(
      rejected.length,
      11
    );

    for (
      const result
      of rejected
    ) {
      assert.equal(
        result.reason instanceof
          StorageConflictError,
        true
      );
    }

    const verifier =
      new SqliteRuntimeState(
        file
      );

    const durable =
      await verifier
        .loadExecution(
          execution.id
        );

    assert.equal(
      durable?.revision,
      2
    );

    assert.equal(
      durable?.status,
      "completed"
    );

    verifier.close();

    console.log(
      JSON.stringify(
        {
          concurrentWriters:
            connections.length,
          durableWinners:
            fulfilled.length,
          revisionConflicts:
            rejected.length,
          finalRevision:
            durable?.revision
        },
        null,
        2
      )
    );

    console.log(
      "UAIR SQLite adversarial multi-connection concurrency: PASS"
    );
  } finally {
    for (
      const state
      of connections
    ) {
      try {
        state.close();
      } catch {}
    }
  }
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
