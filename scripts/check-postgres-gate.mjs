import assert from "node:assert/strict";
import {
  readFile
} from "node:fs/promises";

const workflow =
  await readFile(
    ".github/workflows/postgres-integration.yml",
    "utf8"
  );

const harness =
  await readFile(
    "examples/postgres-integration/index.mjs",
    "utf8"
  );

const adapter =
  await readFile(
    "packages/postgres/src/index.ts",
    "utf8"
  );

const mcpAdapter =
  await readFile(
    "packages/mcp/src/postgres-invocation-store.ts",
    "utf8"
  );

assert.match(
  workflow,
  /image:\s*postgres:16/
);

assert.match(
  workflow,
  /DATABASE_URL/
);

assert.match(
  workflow,
  /examples\/postgres-integration\/index\.mjs/
);

assert.match(
  workflow,
  /test:mcp-invocation-postgres/
);

for (
  const phrase
  of [
    "testConcurrentClaim",
    "testConcurrentReclaim",
    "testSharedRegistryAcrossConnections",
    "testAtomicCapacityReservation",
    "testTwoSchedulersOneCapacitySlot",
    "testRuntimeSchemaForwardRefusal",
    "testRuntimeSuspensionAtomicity",
    "testRuntimeConcurrentRevision",
    "testRuntimeTransactionRollbackOnDatabaseError",
    "testRuntimeConcurrentCreate"
  ]
) {
  assert.match(
    harness,
    new RegExp(phrase)
  );
}

assert.match(
  adapter,
  /FOR UPDATE SKIP LOCKED/
);

assert.match(
  mcpAdapter,
  /pg_advisory_xact_lock/
);

assert.match(
  mcpAdapter,
  /ON CONFLICT DO NOTHING/
);

assert.match(
  mcpAdapter,
  /FOR UPDATE/
);

assert.match(
  adapter,
  /UPDATE uair_routed_jobs AS jobs/
);

assert.match(
  adapter,
  /RETURNING jobs\.\*/
);

assert.match(
  adapter,
  /queue_depth \+ active_jobs < capacity/
);

assert.match(
  adapter,
  /UPDATE uair_worker_registry AS workers/
);

assert.match(
  adapter,
  /RETURNING workers\.worker_id/
);

assert.match(
  adapter,
  /PostgresRuntimeState/
);

assert.match(
  adapter,
  /FOR UPDATE SKIP LOCKED/
);

console.log(
  "UAIR v0.61 PostgreSQL gate contract check: PASS"
);
