import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileMcpInvocationStore } from "../packages/mcp/dist/index.js";

const dir = await mkdtemp(join(tmpdir(), "uair-mcp-invocations-"));
const store = new JsonFileMcpInvocationStore(dir);
const input = {
  principalKey: "acme:E1001",
  toolName: "leave.request",
  idempotencyKey: "request-42"
};
const record = { ...input, executionId: "exp_leave_42", createdAt: 1 };
const duplicate = { ...record, executionId: "exp_duplicate", createdAt: 2 };

assert.equal(await store.find(input), null);
const winners = await Promise.all([
  store.saveIfAbsent(record),
  store.saveIfAbsent(duplicate)
]);
assert.equal(winners[0].executionId, winners[1].executionId);
assert.ok([record.executionId, duplicate.executionId].includes(winners[0].executionId));

const reopened = new JsonFileMcpInvocationStore(dir);
assert.deepEqual(await reopened.find(input), winners[0]);
console.log("UAIR MCP invocation idempotency store: PASS");
