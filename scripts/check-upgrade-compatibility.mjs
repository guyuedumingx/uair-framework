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
  builtinHistoryMigrations,
  CURRENT_HISTORY_SCHEMA_VERSION,
  HistorySchemaTooNewError,
  migrateExecutionHistory
} from "../packages/core/dist/runtime-api.js";

import {
  SQLITE_RUNTIME_SCHEMA_VERSION,
  SqliteRuntimeSchemaTooNewError,
  SqliteRuntimeState
} from "../packages/sqlite/dist/index.js";

const baseExecution = {
  id:
    "upgrade-1",
  workflow:
    "upgrade.workflow",
  workflowVersion:
    "1",
  input: {
    stable:
      true
  },
  status:
    "suspended",
  history: []
};

// History N-1 -> N
const previousHistory = {
  ...structuredClone(
    baseExecution
  ),
  historySchemaVersion:
    CURRENT_HISTORY_SCHEMA_VERSION -
    1
};

const migrated =
  migrateExecutionHistory(
    previousHistory,
    builtinHistoryMigrations
  );

assert.equal(
  migrated.historySchemaVersion,
  CURRENT_HISTORY_SCHEMA_VERSION
);

// History N stays stable.
const currentHistory = {
  ...structuredClone(
    baseExecution
  ),
  historySchemaVersion:
    CURRENT_HISTORY_SCHEMA_VERSION
};

const unchanged =
  migrateExecutionHistory(
    currentHistory,
    builtinHistoryMigrations
  );

assert.equal(
  unchanged,
  currentHistory,
  "current History schema should not be rewritten unnecessarily"
);

// History N+1 must fail closed.
const futureHistory = {
  ...structuredClone(
    baseExecution
  ),
  historySchemaVersion:
    CURRENT_HISTORY_SCHEMA_VERSION +
    1
};

assert.throws(
  () =>
    migrateExecutionHistory(
      futureHistory,
      builtinHistoryMigrations
    ),
  HistorySchemaTooNewError
);

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-upgrade-"
    )
  );

try {
  // Storage N-1 fixture -> current.
  const previousFile =
    join(
      dir,
      "previous.sqlite"
    );

  const previous =
    new DatabaseSync(
      previousFile
    );

  previous.exec(`
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
      '${SQLITE_RUNTIME_SCHEMA_VERSION - 1}'
    );

    CREATE TABLE executions (
      id TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      workflow_version TEXT,
      deployment_id TEXT,
      workflow_fingerprint TEXT,
      history_schema_version INTEGER,
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
      workflow_version,
      input_json,
      status,
      history_json,
      revision,
      updated_at
    )
    VALUES (
      'storage-n-minus-1',
      'upgrade.workflow',
      '1',
      '{"source":"n-1"}',
      'suspended',
      '[]',
      4,
      1
    );
  `);

  previous.close();

  const current =
    new SqliteRuntimeState(
      previousFile
    );

  const loaded =
    await current
      .loadExecution(
        "storage-n-minus-1"
      );

  assert.equal(
    loaded?.input
      ?.source,
    "n-1"
  );

  const versionRow =
    current.db.prepare(`
      SELECT value
      FROM uair_runtime_meta
      WHERE key =
        'runtime_schema_version'
    `).get();

  assert.equal(
    Number(
      versionRow.value
    ),
    SQLITE_RUNTIME_SCHEMA_VERSION
  );

  // Simulate a mixed v0.54/v0.55 rolling window: both release lines use
  // schema v2, so no storage migration is needed between them. Two
  // independent current-schema connections can alternate writers while
  // preserving optimistic revision.
  const peer =
    new SqliteRuntimeState(
      previousFile
    );

  const peerCopy =
    await peer.loadExecution(
      "storage-n-minus-1"
    );

  peerCopy.result = {
    writer:
      "peer"
  };

  await peer.saveExecution(
    peerCopy,
    peerCopy.revision
  );

  const afterPeer =
    await current
      .loadExecution(
        "storage-n-minus-1"
      );

  afterPeer.result = {
    writer:
      "current"
  };

  await current.saveExecution(
    afterPeer,
    afterPeer.revision
  );

  const rolled =
    await peer.loadExecution(
      "storage-n-minus-1"
    );

  assert.equal(
    rolled.result
      .writer,
    "current"
  );

  assert.equal(
    rolled.revision,
    6
  );

  peer.close();
  current.close();

  // Storage N+1 must fail closed.
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
      '${SQLITE_RUNTIME_SCHEMA_VERSION + 1}'
    );
  `);

  future.close();

  assert.throws(
    () =>
      new SqliteRuntimeState(
        futureFile
      ),
    SqliteRuntimeSchemaTooNewError
  );

  console.log(
    JSON.stringify(
      {
        history: {
          nMinus1ToN:
            "PASS",
          n:
            "PASS",
          nPlus1Refused:
            "PASS"
        },
        sqliteStorage: {
          nMinus1ToN:
            "PASS",
          sameSchemaMixedWriterWindow:
            "PASS",
          nPlus1Refused:
            "PASS"
        }
      },
      null,
      2
    )
  );

  console.log(
    "UAIR N-1/N/N+1 upgrade compatibility verification: PASS"
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
