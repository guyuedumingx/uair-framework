import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  McpInvocationConflictError,
  McpInvocationLeaseLostError,
  PostgresMcpInvocationStore,
  PostgresMcpInvocationSchemaTooNewError,
  SqliteMcpInvocationSchemaTooNewError,
  SqliteMcpInvocationStore
} from "../packages/mcp/dist/index.js";

const runFile = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const mode = process.argv[2];
const action = process.argv[3];

const sharedIdentity = {
  principalKey: "tenant-acme:user-E1001",
  toolName: "company:leave.request",
  idempotencyKey: "transactional-request"
};

const sharedOptions = {
  accessScopeKey: "tenant:acme",
  requestHash: "sha256:transactional-request",
  now: 1_000,
  leaseDurationMs: 10_000
};

function assertionsForContract(
  makeStore,
  closeStore
) {
  return async () => {
    const stores = await Promise.all(
      Array.from(
        { length: 24 },
        () => makeStore()
      )
    );

    try {
      await Promise.all(
        stores.map(store => store.migrate())
      );

      const claims = await Promise.all(
        Array.from(
          { length: 100 },
          (_, index) =>
            stores[index % stores.length].claim(
              sharedIdentity,
              sharedOptions
            )
        )
      );
      const winner = claims.find(
        result => result.acquired
      );
      assert.ok(winner);
      assert.equal(
        claims.filter(result => result.acquired).length,
        1
      );

      const bound = await stores[1].bindExecution(
        sharedIdentity,
        winner.leaseToken,
        "exp_transactional_1",
        1_001,
        10_000
      );
      assert.equal(bound.status, "bound");
      assert.equal(
        (await stores[2].findByExecutionId(
          "exp_transactional_1"
        ))?.accessScopeKey,
        "tenant:acme"
      );

      await assert.rejects(
        stores[3].claim(sharedIdentity, {
          ...sharedOptions,
          accessScopeKey: "tenant:other"
        }),
        McpInvocationConflictError
      );
      await assert.rejects(
        stores[3].claim(sharedIdentity, {
          ...sharedOptions,
          requestHash: "sha256:different"
        }),
        McpInvocationConflictError
      );

      const crashIdentity = {
        ...sharedIdentity,
        idempotencyKey: "crash-recovery"
      };
      const crashed = await stores[4].claim(
        crashIdentity,
        {
          ...sharedOptions,
          now: 2_000,
          leaseDurationMs: 5
        }
      );
      assert.equal(crashed.acquired, true);
      const recovered = await stores[5].claim(
        crashIdentity,
        {
          ...sharedOptions,
          now: 2_005,
          leaseDurationMs: 5
        }
      );
      assert.equal(recovered.acquired, true);
      assert.notEqual(
        recovered.leaseToken,
        crashed.leaseToken
      );
      await assert.rejects(
        stores[4].renew(
          crashIdentity,
          crashed.leaseToken,
          2_006,
          5
        ),
        McpInvocationLeaseLostError
      );
      const renewed = await stores[5].renew(
        crashIdentity,
        recovered.leaseToken,
        2_006,
        5
      );
      assert.equal(
        renewed.leaseExpiresAt,
        2_011
      );
      await stores[5].release(
        crashIdentity,
        recovered.leaseToken,
        2_007
      );
      const releasedRecovery =
        await stores[6].claim(
          crashIdentity,
          {
            ...sharedOptions,
            now: 2_007,
            leaseDurationMs: 5
          }
        );
      assert.equal(
        releasedRecovery.acquired,
        true
      );
      assert.notEqual(
        releasedRecovery.leaseToken,
        recovered.leaseToken
      );

      const unboundIdentity = {
        ...sharedIdentity,
        idempotencyKey: "complete-before-bind"
      };
      const unbound = await stores[6].claim(
        unboundIdentity,
        {
          ...sharedOptions,
          requestHash: "sha256:complete-before-bind"
        }
      );
      assert.equal(unbound.acquired, true);
      await assert.rejects(
        stores[6].complete(
          unboundIdentity,
          unbound.leaseToken,
          2_100
        ),
        McpInvocationConflictError
      );

      const uniqueExecutionIdentity = {
        ...sharedIdentity,
        idempotencyKey: "unique-execution"
      };
      const uniqueClaim = await stores[6].claim(
        uniqueExecutionIdentity,
        {
          ...sharedOptions,
          requestHash: "sha256:unique-execution"
        }
      );
      assert.equal(uniqueClaim.acquired, true);
      await assert.rejects(
        stores[6].bindExecution(
          uniqueExecutionIdentity,
          uniqueClaim.leaseToken,
          "exp_transactional_1",
          3_000,
          10_000
        ),
        McpInvocationConflictError
      );

      const completed = await stores[7].complete(
        sharedIdentity,
        winner.leaseToken,
        4_000
      );
      assert.equal(completed.status, "complete");
      const replay = await stores[8].claim(
        sharedIdentity,
        {
          ...sharedOptions,
          now: 99_000
        }
      );
      assert.equal(replay.acquired, false);
      assert.equal(replay.record.status, "complete");
    } finally {
      await Promise.all(
        stores.map(closeStore)
      );
    }
  };
}

async function runSqliteWorker() {
  const store = new SqliteMcpInvocationStore(
    process.argv[4]
  );
  try {
    await store.migrate();
    const claim = await store.claim(
      sharedIdentity,
      sharedOptions
    );
    process.stdout.write(
      JSON.stringify({
        acquired: claim.acquired
      })
    );
  } finally {
    store.close();
  }
}

async function runSqlite() {
  const directory = await mkdtemp(
    join(tmpdir(), "uair-mcp-sqlite-")
  );
  const databasePath = join(
    directory,
    "invocations.sqlite"
  );
  await assertionsForContract(
    async () =>
      new SqliteMcpInvocationStore(
        databasePath
      ),
    async store => store.close()
  )();

  const processDatabasePath = join(
    directory,
    "multiprocess.sqlite"
  );
  const processClaims = await Promise.all(
    Array.from({ length: 12 }, () =>
      runFile(process.execPath, [
        scriptPath,
        "sqlite",
        "worker",
        processDatabasePath
      ])
    )
  );
  assert.equal(
    processClaims
      .map(result => JSON.parse(result.stdout))
      .filter(result => result.acquired)
      .length,
    1
  );

  const newerDatabasePath = join(
    directory,
    "newer-schema.sqlite"
  );
  const newerStore =
    new SqliteMcpInvocationStore(
      newerDatabasePath
    );
  await newerStore.migrate();
  newerStore.db.prepare(`
    UPDATE uair_mcp_invocation_meta
    SET value = '2'
    WHERE key = 'schema_version'
  `).run();
  await assert.rejects(
    newerStore.migrate(),
    SqliteMcpInvocationSchemaTooNewError
  );
  newerStore.close();
  console.log(
    "UAIR SQLite MCP transactional invocation store: PASS"
  );
}

async function postgresPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for the PostgreSQL MCP invocation gate"
    );
  }
  const { Pool } = await import("pg");
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 32
  });
}

async function runPostgresWorker() {
  const pool = await postgresPool();
  const store = new PostgresMcpInvocationStore(pool);
  try {
    await store.migrate();
    const claim = await store.claim(
      sharedIdentity,
      sharedOptions
    );
    process.stdout.write(
      JSON.stringify({
        acquired: claim.acquired
      })
    );
  } finally {
    await pool.end();
  }
}

async function runPostgres() {
  const pool = await postgresPool();
  const store = new PostgresMcpInvocationStore(pool);
  await store.migrate();
  await pool.query(
    "TRUNCATE TABLE uair_mcp_invocations"
  );
  await assertionsForContract(
    async () =>
      new PostgresMcpInvocationStore(pool),
    async () => {}
  )();

  await pool.query(`
    UPDATE uair_mcp_invocation_meta
    SET value = '2'
    WHERE key = 'schema_version'
  `);
  await assert.rejects(
    store.migrate(),
    PostgresMcpInvocationSchemaTooNewError
  );
  await pool.query(`
    UPDATE uair_mcp_invocation_meta
    SET value = '1'
    WHERE key = 'schema_version'
  `);

  await pool.query(
    "TRUNCATE TABLE uair_mcp_invocations"
  );
  const processClaims = await Promise.all(
    Array.from({ length: 8 }, () =>
      runFile(process.execPath, [
        scriptPath,
        "postgres",
        "worker"
      ], {
        env: process.env
      })
    )
  );
  assert.equal(
    processClaims
      .map(result => JSON.parse(result.stdout))
      .filter(result => result.acquired)
      .length,
    1
  );
  await pool.end();
  console.log(
    "UAIR PostgreSQL MCP transactional invocation store: PASS"
  );
}

if (mode === "sqlite" && action === "worker") {
  await runSqliteWorker();
} else if (
  mode === "postgres" &&
  action === "worker"
) {
  await runPostgresWorker();
} else if (mode === "sqlite") {
  await runSqlite();
} else if (mode === "postgres") {
  await runPostgres();
} else {
  throw new Error(
    "Usage: check-mcp-transactional-invocations.mjs <sqlite|postgres>"
  );
}
