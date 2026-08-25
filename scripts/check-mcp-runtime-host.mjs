import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, workflow } from "../packages/core/dist/index.js";
import { JsonFileStorage } from "../packages/core/dist/runtime-api.js";
import { interaction, InteractionService } from "../packages/interaction/dist/index.js";
import {
  createMcpRuntimeHost,
  InMemoryMcpInvocationStore,
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
    inputSchema: {
      type: "object",
      required: ["days"],
      properties: { days: { type: "number" } },
      additionalProperties: false
    },
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

let concurrentRuns = 0;
const concurrent = workflow("hr.leave.concurrent", async input => {
  concurrentRuns += 1;
  await new Promise(resolve => setTimeout(resolve, 25));
  return { accepted: input.days > 0 };
});
const concurrentHost = createMcpRuntimeHost({
  storage,
  workflows: [publishWorkflow({
    name: "leave.concurrent",
    inputSchema: {
      type: "object",
      required: ["days"],
      properties: { days: { type: "number" } },
      additionalProperties: false
    },
    workflow: concurrent
  })],
  invocations,
  authorize,
  claimLeaseMs: 200
});
const concurrentHandles = await Promise.all(
  Array.from({ length: 100 }, () => concurrentHost.start({
    principal: employee,
    toolName: "leave.concurrent",
    input: { days: 1 },
    idempotencyKey: "concurrent-1"
  }))
);
assert.equal(new Set(concurrentHandles.map(item => item.executionId)).size, 1);
assert.equal(concurrentRuns, 1);

class CrashAfterExecutionStore extends InMemoryMcpInvocationStore {
  remainingCrashes = 2;

  async complete(...args) {
    if (this.remainingCrashes > 0) {
      this.remainingCrashes -= 1;
      throw new Error("simulated process crash before acknowledgement");
    }
    return super.complete(...args);
  }
}

const crashStore = new CrashAfterExecutionStore();
const crashStorage = new JsonFileStorage(join(dir, "crash-executions"));
let crashWorkflowRuns = 0;
const crashWorkflow = workflow("hr.leave.crash-recovery", async input => {
  crashWorkflowRuns += 1;
  return { accepted: input.days > 0 };
});
const makeCrashHost = () => createMcpRuntimeHost({
  storage: crashStorage,
  workflows: [publishWorkflow({
    name: "leave.crash-recovery",
    inputSchema: {
      type: "object",
      required: ["days"],
      properties: { days: { type: "number" } },
      additionalProperties: false
    },
    workflow: crashWorkflow
  })],
  invocations: crashStore,
  authorize: () => true,
  claimLeaseMs: 15,
  claimPollMs: 2
});
await assert.rejects(
  makeCrashHost().start({
    principal: employee,
    toolName: "leave.crash-recovery",
    input: { days: 1 },
    idempotencyKey: "crash-1"
  }),
  /simulated process crash/
);
await new Promise(resolve => setTimeout(resolve, 20));
const recoveredAfterCrash = await makeCrashHost().start({
  principal: employee,
  toolName: "leave.crash-recovery",
  input: { days: 1 },
  idempotencyKey: "crash-1"
});
assert.equal(recoveredAfterCrash.status, "completed");
assert.equal(crashWorkflowRuns, 1);

await assert.rejects(
  host.start({
    principal: employee,
    toolName: "leave.request",
    input: { days: "three" },
    idempotencyKey: "invalid-input"
  }),
  /input validation failed/
);
await assert.rejects(
  host.start({
    principal: employee,
    toolName: "leave.request",
    input: { days: 3 },
    idempotencyKey: ""
  }),
  /non-empty idempotency key/
);
await assert.rejects(
  host.start({
    principal: employee,
    toolName: "leave.request",
    input: { days: 4 },
    idempotencyKey: "leave-1"
  }),
  /different input/
);
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
const permissiveHost = createMcpRuntimeHost({
  storage,
  workflows: published,
  invocations,
  authorize: () => true,
  interactions: new InteractionService(storage)
});
await assert.rejects(
  permissiveHost.resolve({
    principal: stranger,
    interactionId: pending.id,
    value: true
  }),
  /Execution access denied/
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

await assert.rejects(
  permissiveHost.read({
    principal: stranger,
    executionId: first.executionId
  }),
  /Execution access denied/
);
await assert.rejects(
  permissiveHost.cancel({
    principal: stranger,
    executionId: cancellable.executionId
  }),
  /Execution access denied/
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
