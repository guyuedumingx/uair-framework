import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  run,
  resume,
  workflow
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage,
  resolveSuspension
} from "../packages/core/dist/runtime-api.js";

import {
  externalAgent,
  durableWorkflowTool
} from "../packages/agent/dist/index.js";

import {
  interaction,
  InteractionService
} from "../packages/interaction/dist/index.js";

class JsonStore {
  constructor(dir) {
    this.dir = dir;
  }

  file(id) {
    return join(this.dir, `${id}.json`);
  }

  async put(id, value) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(id), JSON.stringify(value, null, 2) + "\n");
  }

  async get(id) {
    return JSON.parse(await readFile(this.file(id), "utf8"));
  }
}

/**
 * Emulates the documented OpenAI Agents SDK ownership model:
 * Session owns conversation history; agent tools remain owned by the SDK.
 */
class OpenAiSessionRuntime {
  constructor(store) {
    this.store = store;
    this.skillCalls = 0;
    this.privateInstructions = "OPENAI_PRIVATE_SYSTEM::support-agent-v9";
    this.privateSkill = "OPENAI_PRIVATE_SKILL::refund-policy";
  }

  async run(input) {
    if (!input.sessionRef) {
      const sessionId = `oa-session-${Date.now()}-${Math.random()}`;
      await this.store.put(sessionId, {
        items: [
          { role: "system", content: this.privateInstructions },
          { role: "user", content: input.input.message }
        ],
        memory: { preference: "concise" },
        toolState: { installed: [this.privateSkill] }
      });
      return {
        type: "suspended",
        sessionRef: { provider: "openai-agents", sessionId },
        request: { kind: "agent.approval", summary: "approve refund" }
      };
    }

    const state = await this.store.get(input.sessionRef.sessionId);
    state.items.push({ role: "user", content: `resume:${JSON.stringify(input.resume)}` });
    this.skillCalls += 1;
    state.items.push({ role: "assistant", content: "refund-approved" });
    await this.store.put(input.sessionRef.sessionId, state);

    return {
      type: "completed",
      sessionRef: input.sessionRef,
      output: {
        answer: "refund-approved",
        remembered: state.memory.preference === "concise",
        skillAvailable: state.toolState.installed.includes(this.privateSkill),
        itemCount: state.items.length
      }
    };
  }
}

/**
 * Emulates LangGraph persistence semantics: a thread_id points to external
 * checkpoints and resume re-enters the framework using the same thread.
 */
class LangGraphRuntime {
  constructor(store) {
    this.store = store;
    this.privateCheckpointMarker = "LANGGRAPH_PRIVATE_CHECKPOINT::graph-state";
  }

  async run(input) {
    if (!input.sessionRef) {
      const threadId = `lg-thread-${Date.now()}-${Math.random()}`;
      await this.store.put(threadId, {
        graphVersion: "graph-v7",
        checkpoint: this.privateCheckpointMarker,
        messages: [{ role: "user", content: input.input.message }],
        node: "human_review"
      });
      return {
        type: "suspended",
        sessionRef: { provider: "langgraph", threadId },
        request: { kind: "langgraph.interrupt", payload: { question: "approve?" } }
      };
    }

    const checkpoint = await this.store.get(input.sessionRef.threadId);
    checkpoint.messages.push({ role: "human", content: input.resume });
    checkpoint.node = "done";
    await this.store.put(input.sessionRef.threadId, checkpoint);

    return {
      type: "completed",
      sessionRef: input.sessionRef,
      output: {
        graphVersion: checkpoint.graphVersion,
        checkpointRestored: checkpoint.checkpoint === this.privateCheckpointMarker,
        result: `approved:${String(input.resume)}`
      }
    };
  }
}

/**
 * Emulates Claude/Managed-Agent semantics: session + pinned agent version
 * own conversation state, tools/MCP/skills stay attached outside UAIR.
 */
class ClaudeSessionRuntime {
  constructor(store) {
    this.store = store;
    this.privateSkill = "CLAUDE_PRIVATE_SKILL::asset-investigation";
    this.privateSystem = "CLAUDE_PRIVATE_SYSTEM::risk-agent";
  }

  async run(input) {
    if (!input.sessionRef) {
      const sessionId = `claude-session-${Date.now()}-${Math.random()}`;
      await this.store.put(sessionId, {
        agentId: "agent-risk",
        agentVersion: "12",
        system: this.privateSystem,
        skills: [this.privateSkill],
        events: [{ type: "user.message", text: input.input.message }]
      });
      return {
        type: "suspended",
        sessionRef: {
          provider: "claude-managed-agent",
          sessionId,
          agentVersion: "12"
        },
        request: { kind: "tool.confirmation", tool: "freeze_asset" }
      };
    }

    const session = await this.store.get(input.sessionRef.sessionId);
    session.events.push({ type: "user.message", text: `resume:${JSON.stringify(input.resume)}` });
    await this.store.put(input.sessionRef.sessionId, session);

    return {
      type: "completed",
      sessionRef: input.sessionRef,
      output: {
        agentVersion: session.agentVersion,
        skillAvailable: session.skills.includes(this.privateSkill),
        eventCount: session.events.length,
        result: "asset-action-complete"
      }
    };
  }
}

async function verifyHostedFramework({
  name,
  runtimeFactory,
  privateMarkers,
  assertOutput
}) {
  const root = await mkdtemp(join(tmpdir(), `uair-${name}-`));
  const agentStore = new JsonStore(join(root, "agent-owned-state"));
  const uairStorage = new JsonFileStorage(join(root, "uair-runtime"));

  try {
    let runtime = runtimeFactory(agentStore);
    const runtimeProxy = { run: input => runtime.run(input) };
    const agentStep = externalAgent(name, runtimeProxy);
    const ask = interaction(`compat.${name}.external-input`);

    const flow = workflow(`compat.${name}`, { version: "1" }, async input => {
      const first = await agentStep({ input });
      if (first.type === "completed") return first.output;

      const answer = await ask({
        assignee: "user:operator",
        data: first.request,
        metadata: { framework: name }
      });

      const second = await agentStep({
        sessionRef: first.sessionRef,
        resume: answer
      });

      if (second.type !== "completed") {
        throw new Error(`${name} asked for a second external input in test`);
      }

      return second.output;
    });

    const started = await run(flow, { message: "perform task" }, uairStorage);
    assert.equal(started.status, "suspended");

    const service = new InteractionService(uairStorage);
    const inbox = await service.listPending("user:operator");
    assert.equal(inbox.length, 1);

    // Hard boundary: UAIR history may contain sessionRef/request, but must not
    // contain framework-owned memory/checkpoint/skills/system instructions.
    const before = JSON.stringify((await uairStorage.loadExecution(started.id)).history);
    for (const marker of privateMarkers) {
      assert.equal(before.includes(marker), false, `${name}: private state leaked into UAIR History`);
    }

    // Simulate framework process restart. Only framework-owned persistent
    // state + opaque sessionRef allow recovery.
    runtime = runtimeFactory(agentStore);

    await service.resolve({
      interactionId: inbox[0].id,
      actor: "user:operator",
      value: name === "langgraph" ? true : { approved: true }
    });

    const completed = await resume(flow, started.id, uairStorage);
    assert.equal(completed.status, "completed");
    assertOutput(completed.result);

    const after = JSON.stringify(completed.history);
    for (const marker of privateMarkers) {
      assert.equal(after.includes(marker), false, `${name}: private state leaked after resume`);
    }

    return {
      hosted: "PASS",
      restartResume: "PASS",
      noPrivateStateLeak: "PASS"
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function verifyAgentCallsUair() {
  const root = await mkdtemp(join(tmpdir(), "uair-agent-calls-uair-"));
  const storage = new JsonFileStorage(join(root, "runtime"));

  try {
    const checkout = workflow("commerce.checkout", { version: "1" }, async input => ({
      orderId: `order:${input.sku}`,
      total: 42
    }));

    const tool = durableWorkflowTool(checkout, storage);
    const outerAgent = {
      memory: ["PRIVATE_OUTER_MEMORY::prefers-fast-checkout"],
      skills: ["PRIVATE_OUTER_SKILL::shopping"],
      async run() {
        const result = await tool.start({ sku: "tea" });
        return {
          result,
          memoryStillThere: this.memory[0],
          skillStillThere: this.skills[0]
        };
      }
    };

    const result = await outerAgent.run();
    assert.equal(result.result.status, "completed");
    assert.equal(result.memoryStillThere, "PRIVATE_OUTER_MEMORY::prefers-fast-checkout");
    assert.equal(result.skillStillThere, "PRIVATE_OUTER_SKILL::shopping");

    const execution = await storage.loadExecution(result.result.executionId);
    const history = JSON.stringify(execution.history);
    assert.equal(history.includes("PRIVATE_OUTER_MEMORY"), false);
    assert.equal(history.includes("PRIVATE_OUTER_SKILL"), false);

    return {
      agentAsOrchestrator: "PASS",
      outerMemoryPreserved: "PASS",
      outerSkillPreserved: "PASS"
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const openai = await verifyHostedFramework({
  name: "openai-agents",
  runtimeFactory: store => new OpenAiSessionRuntime(store),
  privateMarkers: [
    "OPENAI_PRIVATE_SYSTEM::support-agent-v9",
    "OPENAI_PRIVATE_SKILL::refund-policy"
  ],
  assertOutput(output) {
    assert.equal(output.answer, "refund-approved");
    assert.equal(output.remembered, true);
    assert.equal(output.skillAvailable, true);
  }
});

const langgraph = await verifyHostedFramework({
  name: "langgraph",
  runtimeFactory: store => new LangGraphRuntime(store),
  privateMarkers: ["LANGGRAPH_PRIVATE_CHECKPOINT::graph-state"],
  assertOutput(output) {
    assert.equal(output.graphVersion, "graph-v7");
    assert.equal(output.checkpointRestored, true);
    assert.equal(output.result, "approved:true");
  }
});

const claude = await verifyHostedFramework({
  name: "claude-managed-agent",
  runtimeFactory: store => new ClaudeSessionRuntime(store),
  privateMarkers: [
    "CLAUDE_PRIVATE_SKILL::asset-investigation",
    "CLAUDE_PRIVATE_SYSTEM::risk-agent"
  ],
  assertOutput(output) {
    assert.equal(output.agentVersion, "12");
    assert.equal(output.skillAvailable, true);
    assert.equal(output.result, "asset-action-complete");
  }
});

const inverse = await verifyAgentCallsUair();

const matrix = {
  "OpenAI Agents SDK model": {
    sessionOwnership: "external",
    memoryOwnership: "external Session",
    skillsToolsOwnership: "external Agent SDK",
    adapterMode: "opaque sessionRef",
    ...openai
  },
  "LangGraph model": {
    checkpointOwnership: "external checkpointer/thread_id",
    interruptOwnership: "external graph",
    adapterMode: "opaque threadRef by default",
    ...langgraph
  },
  "Claude managed/session model": {
    sessionOwnership: "external",
    agentVersionOwnership: "external",
    skillsOwnership: "external",
    adapterMode: "opaque sessionRef",
    ...claude
  },
  "Agent -> UAIR Workflow": inverse
};

console.log(JSON.stringify(matrix, null, 2));
console.log("UAIR Agent compatibility matrix verification: PASS");
