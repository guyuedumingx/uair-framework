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
  DatabaseSync
} from "node:sqlite";

import {
  SQLITE_RUNTIME_SCHEMA_VERSION,
  SqliteRuntimeSchemaTooNewError,
  SqliteRuntimeState
} from "../packages/sqlite/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-schema-"
    )
  );

try {
  const legacyFile =
    join(
      dir,
      "legacy.sqlite"
    );

  const legacy =
    new DatabaseSync(
      legacyFile
    );

  legacy.exec(`
    CREATE TABLE executions (
      id TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      input_json TEXT,
      status TEXT NOT NULL,
      history_json TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO executions (
      id,
      workflow,
      input_json,
      status,
      history_json,
      revision,
      updated_at
    )
    VALUES (
      'legacy-1',
      'legacy.workflow',
      '{"x":1}',
      'suspended',
      '[]',
      7,
      1
    );
  `);

  legacy.close();

  const migrated =
    new SqliteRuntimeState(
      legacyFile
    );

  const loaded =
    await migrated
      .loadExecution(
        "legacy-1"
      );

  assert.equal(
    loaded?.workflow,
    "legacy.workflow"
  );

  assert.equal(
    loaded?.revision,
    7
  );

  const meta =
    migrated.db.prepare(`
      SELECT value
      FROM uair_runtime_meta
      WHERE key =
        'runtime_schema_version'
    `).get();

  assert.equal(
    Number(
      meta.value
    ),
    SQLITE_RUNTIME_SCHEMA_VERSION
  );

  const columns =
    migrated.db.prepare(`
      PRAGMA table_info(executions)
    `).all()
      .map(
        row =>
          row.name
      );

  for (
    const required
    of [
      "workflow_version",
      "deployment_id",
      "workflow_fingerprint",
      "history_schema_version"
    ]
  ) {
    assert.equal(
      columns.includes(
        required
      ),
      true,
      `legacy database must gain ${required}`
    );
  }

  migrated.close();

  const futureFile =
    join(
      dir,
      "future.sqlite"
    );

  const future =
    new DatabaseSync(
      futureFile
    );

  future.exec(`
    CREATE TABLE uair_runtime_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT INTO uair_runtime_meta (
      key,
      value
    )
    VALUES (
      'runtime_schema_version',
      '999'
    );
  `);

  future.close();

  assert.throws(
    () =>
      new SqliteRuntimeState(
        futureFile
      ),
    SqliteRuntimeSchemaTooNewError,
    "older Runtime must refuse a newer unknown storage schema"
  );

  console.log(
    JSON.stringify(
      {
        legacyMigration:
          "PASS",
        legacyRevision:
          loaded?.revision,
        schemaVersion:
          SQLITE_RUNTIME_SCHEMA_VERSION,
        forwardSchemaRefusal:
          "PASS"
      },
      null,
      2
    )
  );

  console.log(
    "UAIR Runtime storage schema migration compatibility: PASS"
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
