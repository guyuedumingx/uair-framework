import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  run,
  workflow
} from "../packages/core/dist/index.js";
import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";
import {
  CodexAppServerRuntime,
  externalAgent
} from "../packages/agent/dist/index.js";

const root = await mkdtemp(join(tmpdir(), "uair-codex-app-server-"));
const server = join(root, "fake-app-server.mjs");

await writeFile(
  server,
  `import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });
let turn = 0;
let pendingApproval = null;
let resumed = false;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function complete(threadId, turnId, text) {
  send({ method: "item/agentMessage/delta", params: { delta: text } });
  send({ method: "turn/completed", params: { turn: { id: turnId, status: "completed", output: text } } });
}

input.on("line", line => {
  const message = JSON.parse(line);

  if (message.id === 99 && pendingApproval) {
    const finish = pendingApproval;
    pendingApproval = null;
    finish(message.result);
    return;
  }

  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake-codex", platformFamily: "test", platformOs: "test" } });
    return;
  }

  if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-1", sessionId: "session-1" } } });
    return;
  }

  if (message.method === "thread/resume") {
    resumed = true;
    send({ id: message.id, result: { thread: { id: message.params.threadId, sessionId: "session-1" } } });
    return;
  }

  if (message.method === "turn/start") {
    turn += 1;
    const turnId = "turn-" + turn;
    send({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });

    if (turn === 1 && !resumed) {
      send({ id: 99, method: "item/commandExecution/requestApproval", params: { command: ["echo", "hello"], reason: "test" } });
      pendingApproval = result => complete(message.params.threadId, turnId, result?.decision === "accept" ? "approved" : "declined");
    } else {
      complete(message.params.threadId, turnId, "resumed");
    }
  }
});
`,
  "utf8"
);

const events = [];
const runtime = new CodexAppServerRuntime({
  binary: process.execPath,
  appServerArgs: [server],
  timeoutMs: 10_000,
  onEvent: event => events.push(event),
  onServerRequest: async request => {
    assert.equal(request.method, "item/commandExecution/requestApproval");
    return { decision: "accept" };
  }
});

try {
  const first = await runtime.run({ input: "run the command" });

  assert.equal(first.type, "completed");
  assert.equal(first.output.text, "approved");
  assert.equal(first.sessionRef.provider, "codex-app-server");
  assert.ok(events.some(event => event.method === "item/commandExecution/requestApproval"));

  const second = await runtime.run({
    input: "continue",
    sessionRef: first.sessionRef,
    resume: { approved: true }
  });

  assert.equal(second.type, "completed");
  assert.equal(second.output.text, "resumed");
  assert.equal(second.sessionRef.threadId, first.sessionRef.threadId);

  const step = externalAgent("codex", runtime);
  const flow = workflow("check.codex.app-server", async input =>
    (await step({ input })).output
  );
  const execution = await run(
    flow,
    "embedded turn",
    new JsonFileStorage(join(root, "uair-state"))
  );
  assert.equal(execution.result.text, "approved");

  console.log(JSON.stringify({
    initialize: "PASS",
    threadStartAndResume: "PASS",
    streamedEvents: "PASS",
    approvalRequestBridge: "PASS",
    externalAgentBoundary: "PASS"
  }, null, 2));
  console.log("UAIR Codex App Server adapter verification: PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
