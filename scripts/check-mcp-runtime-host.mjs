import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, workflow } from "../packages/core/dist/index.js";
import { JsonFileStorage } from "../packages/core/dist/runtime-api.js";
import { interaction, InteractionService } from "../packages/interaction/dist/index.js";
import {
  createMcpRuntimeHost,
  JsonFileMcpInvocationStore,
  publishWorkflow
} from "../packages/mcp/dist/index.js";

const dir = await mkdtemp(join(tmpdir(), "uair-mcp-host-"));
const storage = new JsonFileStorage(join(dir, "executions"));
const invocations = new JsonFileMcpInvocationStore(join(dir, "invocations"));
const approve = interaction("manager-approval");
let completedRuns = 0;

const leave = workflow("hr.leave.request", async input => {
  completedRuns += 1;
  return { accepted: input.days > 0 };
});
const guardedLeave = workflow("hr.leave.guarded", async input => {
  const accepted = await approve({
    assignee: "manager-1",
    data: input
  });
  return { accepted };
});
const published = [
  publishWorkflow({
    name: "leave.request",
    inputSchema: { type: "object" },
    workflow: leave
  }),
  publishWorkflow({
    name: "leave.guarded",
    inputSchema: { type: "object" },
    workflow: guardedLeave
  })
];
const employee = { id: "employee-1", tenantId: "acme" };
const manager = { id: "manager-1", tenantId: "acme" };
const stranger = { id: "stranger", tenantId: "other" };
const authorize = input => {
  if (input.action === "discover" || input.action === "start") {
    return input.principal.tenantId === "acme";
  }
  if (input.action === "resolve") {
    return input.principal.id === "manager-1";
  }
  return input.principal.tenantId === "acme";
};
const makeHost = () => createMcpRuntimeHost({
  storage,
  workflows: published,
  invocations,
  authorize,
  interactions: new InteractionService(storage)
});
const host = makeHost();

assert.deepEqual((await host.listTools(employee)).map(item => item.name), [
  "leave.request",
  "leave.guarded"
]);
const first = await host.start({
  principal: employee,
  toolName: "leave.request",
  input: { days: 3 },
  idempotencyKey: "leave-1"
});
const retry = await host.start({
  principal: employee,
  toolName: "leave.request",
  input: { days: 3 },
  idempotencyKey: "leave-1"
});
assert.equal(retry.executionId, first.executionId);
assert.equal(completedRuns, 1);
assert.equal((await makeHost().start({
  principal: employee,
  toolName: "leave.request",
  input: { days: 3 },
  idempotencyKey: "leave-1"
})).executionId, first.executionId);
assert.equal(completedRuns, 1);

await assert.rejects(
  host.read({ principal: stranger, executionId: first.executionId }),
  /MCP Runtime authorization denied/
);
const suspended = await host.start({
  principal: employee,
  toolName: "leave.guarded",
  input: { days: 5 },
  idempotencyKey: "guarded-1"
});
assert.equal(suspended.status, "suspended");
const [pending] = await new InteractionService(storage).listPending("manager-1");
await assert.rejects(
  host.resolve({ principal: employee, interactionId: pending.id, value: true }),
  /MCP Runtime authorization denied/
);
assert.equal((await host.resolve({
  principal: manager,
  interactionId: pending.id,
  value: true
})).status, "suspended");

const cancellable = await host.start({
  principal: employee,
  toolName: "leave.guarded",
  input: { days: 2 },
  idempotencyKey: "guarded-cancel"
});
assert.equal((await host.cancel({
  principal: employee,
  executionId: cancellable.executionId
})).status, "cancelled");
await assert.rejects(
  host.cancel({ principal: employee, executionId: first.executionId }),
  /not currently cancellable/
);

const deniedActions = ["discover", "start", "read", "resolve", "cancel"];
for (const deniedAction of deniedActions) {
  const denied = createMcpRuntimeHost({
    storage,
    workflows: published,
    invocations,
    authorize: input => input.action !== deniedAction,
    interactions: new InteractionService(storage)
  });
  const operation = deniedAction === "discover"
    ? () => denied.listTools(employee)
    : deniedAction === "start"
      ? () => denied.start({ principal: employee, toolName: "leave.request", input: {}, idempotencyKey: "denied" })
      : deniedAction === "read"
        ? () => denied.read({ principal: employee, executionId: first.executionId })
        : deniedAction === "resolve"
          ? () => denied.resolve({ principal: employee, interactionId: "missing", value: true })
          : () => denied.cancel({ principal: employee, executionId: first.executionId });
  await assert.rejects(operation, /MCP Runtime authorization denied/);
}

assert.equal((await host.read({ principal: employee, executionId: first.executionId })).result.accepted, true);
console.log("UAIR MCP Runtime host: PASS");
