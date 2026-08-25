import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { JsonFileMcpInvocationStore } from "../packages/mcp/dist/index.js";

const workerIdentity = {
  principalKey: "acme:E1001",
  toolName: "leave.request",
  idempotencyKey: "multiprocess-request"
};
const workerClaimOptions = {
  accessScopeKey: "tenant:acme",
  requestHash: "multiprocess-request-hash",
  now: 1,
  leaseDurationMs: 10_000
};

if (process.argv[2] === "--claim-worker") {
  const workerStore = new JsonFileMcpInvocationStore(process.argv[3]);
  const result = await workerStore.claim(
    workerIdentity,
    workerClaimOptions
  );
  await new Promise(resolve => {
    process.stdout.write(
      JSON.stringify({ acquired: result.acquired }),
      resolve
    );
  });
  process.exit(0);
}

const dir = await mkdtemp(join(tmpdir(), "uair-mcp-invocations-"));
const store = new JsonFileMcpInvocationStore(dir);
const input = {
  principalKey: "acme:E1001",
  toolName: "leave.request",
  idempotencyKey: "request-42"
};
const claimInput = {
  accessScopeKey: "tenant:acme",
  requestHash: "request-hash-42",
  now: 1,
  leaseDurationMs: 100
};

assert.equal(await store.find(input), null);
const claims = await Promise.all(
  Array.from(
    { length: 100 },
    () => store.claim(input, claimInput)
  )
);
const winners = claims.filter(item => item.acquired);
assert.equal(winners.length, 1);
const winner = winners[0];
assert.equal(winner.record.status, "claimed");

const bound = await store.bindExecution(
  input,
  winner.leaseToken,
  "exp_leave_42",
  2,
  100
);
assert.equal(bound.status, "bound");
assert.equal(
  (await store.findByExecutionId("exp_leave_42"))?.accessScopeKey,
  "tenant:acme"
);
await store.complete(input, winner.leaseToken, 3);

const reopened = new JsonFileMcpInvocationStore(dir);
assert.equal((await reopened.find(input))?.status, "complete");
assert.equal(
  (await reopened.findByExecutionId("exp_leave_42"))?.principalKey,
  input.principalKey
);

const crashIdentity = {
  ...input,
  idempotencyKey: "crash-after-claim"
};
const crashed = await reopened.claim(crashIdentity, {
  ...claimInput,
  now: 10,
  leaseDurationMs: 5
});
assert.equal(crashed.acquired, true);
const beforeExpiry = await reopened.claim(crashIdentity, {
  ...claimInput,
  now: 14,
  leaseDurationMs: 5
});
assert.equal(beforeExpiry.acquired, false);
const recovered = await reopened.claim(crashIdentity, {
  ...claimInput,
  now: 15,
  leaseDurationMs: 5
});
assert.equal(recovered.acquired, true);
assert.notEqual(recovered.leaseToken, crashed.leaseToken);

await assert.rejects(
  reopened.claim(input, {
    ...claimInput,
    requestHash: "different-request",
    now: 4
  }),
  /different input/
);

const multiprocessDir = await mkdtemp(
  join(tmpdir(), "uair-mcp-invocations-multiprocess-")
);
const runFile = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const processClaims = await Promise.all(
  Array.from({ length: 12 }, () =>
    runFile(process.execPath, [
      scriptPath,
      "--claim-worker",
      multiprocessDir
    ])
  )
);
assert.equal(
  processClaims
    .map(item => JSON.parse(item.stdout))
    .filter(item => item.acquired)
    .length,
  1
);
console.log("UAIR MCP invocation idempotency store: PASS");
