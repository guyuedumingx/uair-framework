import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const corePackage = JSON.parse(
  await readFile(resolve(root, "packages/core/package.json"), "utf8")
);

assert.deepEqual(
  Object.keys(corePackage.exports).sort(),
  [".", "./adapter", "./cluster", "./internal", "./runtime"],
  "@uair/core must expose exactly the reviewed v1-alpha entry points"
);

const app = await import(
  pathToFileURL(resolve(root, "packages/core/dist/index.js")).href
);

const expectedRuntimeExports = [
  "ExecutionCancelledError",
  "NonDeterministicWorkflowError",
  "RuntimeEngine",
  "WorkflowVersionMismatchError",
  "component",
  "parallel",
  "race",
  "resume",
  "run",
  "workflow"
].sort();

assert.deepEqual(
  Object.keys(app).sort(),
  expectedRuntimeExports,
  "@uair/core root runtime export surface drifted; review before expanding v1 API"
);

const rootIndex = await readFile(
  resolve(root, "packages/core/src/index.ts"),
  "utf8"
);

for (const forbidden of [
  "HistoryEntry",
  "currentFence",
  "runWithFence",
  "WorkerDirectory",
  "ReliableWorkerQueue",
  "SharedWorkerRegistry",
  "StorageConflictError",
  "JsonFileStorage"
]) {
  assert.equal(
    rootIndex.includes(forbidden),
    false,
    `internal/operational symbol leaked into @uair/core root: ${forbidden}`
  );
}

console.log("UAIR v1-alpha API surface check: PASS");
