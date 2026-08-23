import assert from "node:assert/strict";
import { executionTaskStatus } from "../packages/mcp/dist/index.js";

assert.equal(executionTaskStatus("running"), "working");
assert.equal(executionTaskStatus("suspended"), "input_required");
assert.equal(executionTaskStatus("completed"), "completed");
assert.equal(executionTaskStatus("failed"), "failed");
assert.equal(executionTaskStatus("cancelled"), "cancelled");

console.log("UAIR MCP Tasks projection compatibility: PASS (fallback-only for SDK 2.0.0)");
