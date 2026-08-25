import assert from "node:assert/strict";
import { workflow } from "../packages/core/dist/index.js";
import { publishWorkflow } from "../packages/mcp/dist/index.js";

const leave = workflow("hr.leave.request", async input => ({ accepted: input.days > 0 }));
const published = publishWorkflow({
  name: "leave.request",
  description: "Request employee leave",
  inputSchema: {
    type: "object",
    required: ["days"],
    properties: { days: { type: "number", minimum: 0.5 } },
    additionalProperties: false
  },
  workflow: leave
});

assert.equal(published.name, "leave.request");
assert.equal(published.workflow.id, "hr.leave.request");
assert.throws(() => publishWorkflow({ ...published, name: "" }), /non-empty MCP tool name/);
assert.throws(
  () => publishWorkflow({ ...published, name: "uair.execution.get" }),
  /reserved by the UAIR Runtime/
);
console.log("UAIR MCP published Workflow contract: PASS");
