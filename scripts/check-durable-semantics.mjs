import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  component,
  NonDeterministicWorkflowError,
  resume,
  run,
  workflow
} from "../packages/core/dist/index.js";
import { JsonFileStorage } from "../packages/core/dist/runtime-api.js";

const dir = await mkdtemp(join(tmpdir(), "uair-semantics-"));
const storage = new JsonFileStorage(join(dir, "executions"));

let firstCalls = 0;
let secondShouldFail = true;
const attemptEffectIds = [];

const first = component("contract.first", async (_input, ctx) => {
  firstCalls += 1;
  return { effectId: ctx.effectId };
});

const second = component(
  "contract.second",
  { retry: { maxAttempts: 2 } },
  async (_input, ctx) => {
    attemptEffectIds.push(ctx.effectId);
    if (secondShouldFail) throw new Error("injected failure");
    return true;
  }
);

const replayWorkflow = workflow("contract.replay", async () => {
  await first(null);
  return second(null);
});

await assert.rejects(() => run(replayWorkflow, null, storage), /injected failure/);
const [failed] = await storage.listExecutions();
assert.equal(firstCalls, 1);
assert.equal(new Set(attemptEffectIds).size, 1, "retries must reuse one effectId");

secondShouldFail = false;
const completed = await resume(replayWorkflow, failed.id, storage);
assert.equal(completed.status, "completed");
assert.equal(firstCalls, 1, "completed effects must be memoized during replay");

let chooseOriginalBranch = true;
const original = component("contract.original", async () => true);
const changed = component("contract.changed", async () => true);
const nondeterministic = workflow("contract.nondeterministic", async () =>
  chooseOriginalBranch ? original(null) : changed(null)
);

const initial = await run(nondeterministic, null, storage);
chooseOriginalBranch = false;
await assert.rejects(
  () => resume(nondeterministic, initial.id, storage),
  error => error instanceof NonDeterministicWorkflowError
);

console.log(JSON.stringify({
  queueDelivery: "AT_LEAST_ONCE",
  retryEffectIdStable: true,
  completedEffectMemoized: true,
  structuralMismatchFailsClosed: true,
  externalExactlyOnceRequiresDownstreamIdempotency: true
}, null, 2));
console.log("UAIR durable execution semantics verification: PASS");
