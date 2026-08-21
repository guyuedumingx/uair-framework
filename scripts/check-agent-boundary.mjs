import assert from "node:assert/strict";

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

import {
  component,
  resume,
  run,
  workflow
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  externalAgent,
  durableWorkflowTool
} from "../packages/agent/dist/index.js";

import {
  interaction,
  InteractionService
} from "../packages/interaction/dist/index.js";

class ExistingAgentFramework {
  constructor(
    name,
    checkpointDir
  ) {
    this.name = name;
    this.checkpointDir = checkpointDir;
    this.counter = 0;
    this.skillCalls = 0;

    // Framework-owned configuration/state. UAIR must never copy these.
    this.privateMemorySeed =
      "PRIVATE_MEMORY::user-prefers-espresso";

    this.privateSkillInstruction =
      "PRIVATE_SKILL::always-use-domain-calculator-v7";
  }

  skillRegistry() {
    return new Map([
      [
        "domain-calculator",
        {
          instructions:
            this.privateSkillInstruction,
          run: value => {
            this.skillCalls += 1;
            return value * 2;
          }
        }
      ]
    ]);
  }

  stateFile(threadId) {
    return join(
      this.checkpointDir,
      `${threadId}.json`
    );
  }

  async saveState(
    threadId,
    state
  ) {
    await mkdir(
      this.checkpointDir,
      {
        recursive: true
      }
    );

    await writeFile(
      this.stateFile(
        threadId
      ),
      JSON.stringify(
        state,
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  async getState(
    sessionRef
  ) {
    return JSON.parse(
      await readFile(
        this.stateFile(
          sessionRef.threadId
        ),
        "utf8"
      )
    );
  }

  async createSession(
    question
  ) {
    const threadId =
      `${this.name}-thread-${++this.counter}`;

    const state = {
      messages: [
        {
          role: "system",
          content:
            "existing-agent-system-context"
        },
        {
          role: "user",
          content: question
        }
      ],
      memory: [
        this.privateMemorySeed
      ],
      confirmed: false
    };

    await this.saveState(
      threadId,
      state
    );

    return {
      provider:
        "existing-agent-framework",
      threadId
    };
  }

  async run(input) {
    if (!input.sessionRef) {
      const sessionRef =
        await this.createSession(
          input.input.question
        );

      const state =
        await this.getState(
          sessionRef
        );

      state.messages.push({
        role: "assistant",
        content:
          "requesting-confirmation"
      });

      await this.saveState(
        sessionRef.threadId,
        state
      );

      return {
        type: "suspended",
        sessionRef,
        request: {
          kind:
            "agent.confirm-action",
          summary:
            "Confirm the calculation"
        }
      };
    }

    const state =
      await this.getState(
        input.sessionRef
      );

    state.messages.push({
      role: "user",
      content:
        `resume:${JSON.stringify(input.resume)}`
    });

    state.confirmed =
      Boolean(
        input.resume?.approved
      );

    // Skills are reloaded by the external Agent framework itself after
    // restart. They are not serialized into UAIR or its sessionRef.
    const skills =
      this.skillRegistry();

    const skill =
      skills.get(
        "domain-calculator"
      );

    const value =
      skill.run(21);

    const remembersPreference =
      state.memory.includes(
        this.privateMemorySeed
      );

    const output = {
      confirmed:
        state.confirmed,
      calculated:
        value,
      remembersPreference,
      messageCount:
        state.messages.length,
      skillStillInstalled:
        skills.has(
          "domain-calculator"
        )
    };

    state.messages.push({
      role: "assistant",
      content:
        JSON.stringify(output)
    });

    await this.saveState(
      input.sessionRef.threadId,
      state
    );

    return {
      type: "completed",
      output,
      sessionRef:
        input.sessionRef
    };
  }

  async runDirect(question, answer) {
    const first =
      await this.run({
        input: {
          question
        }
      });

    assert.equal(
      first.type,
      "suspended"
    );

    return this.run({
      sessionRef:
        first.sessionRef,
      resume: answer
    });
  }
}

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-agent-boundary-"
    )
  );

try {
  // ------------------------------------------------------------------
  // 1 + 3. UAIR hosts an existing Agent, including suspend/resume.
  // ------------------------------------------------------------------
  const directFramework =
    new ExistingAgentFramework(
      "direct",
      join(
        dir,
        "direct-agent-checkpoints"
      )
    );

  const hostedFramework1 =
    new ExistingAgentFramework(
      "hosted",
      join(
        dir,
        "hosted-agent-checkpoints"
      )
    );

  let activeHostedFramework =
    hostedFramework1;

  const hostedRuntimeProxy = {
    run(input) {
      return activeHostedFramework
        .run(input);
    }
  };

  const question =
    "Use your existing memory and installed skill, but ask before calculating.";

  const approval = {
    approved: true
  };

  const direct =
    await directFramework
      .runDirect(
        question,
        approval
      );

  assert.equal(
    direct.type,
    "completed"
  );

  const storage =
    new JsonFileStorage(
      join(
        dir,
        "hosted-runtime"
      )
    );

  const agentStep =
    externalAgent(
      "existing",
      hostedRuntimeProxy
    );

  const confirm =
    interaction(
      "agent.confirm-action"
    );

  const hostedWorkflow =
    workflow(
      "agent.host-existing",
      async input => {
        let turn =
          await agentStep({
            input
          });

        if (
          turn.type ===
            "completed"
        ) {
          return turn.output;
        }

        const answer =
          await confirm({
            assignee:
              "user:operator",
            data:
              turn.request
          });

        turn =
          await agentStep({
            sessionRef:
              turn.sessionRef,
            resume:
              answer
          });

        if (
          turn.type !==
            "completed"
        ) {
          throw new Error(
            "Fake Agent unexpectedly suspended twice"
          );
        }

        return turn.output;
      }
    );

  const started =
    await run(
      hostedWorkflow,
      {
        question
      },
      storage
    );

  assert.equal(
    started.status,
    "suspended"
  );

  const service =
    new InteractionService(
      storage
    );

  const inbox =
    await service.listPending(
      "user:operator"
    );

  assert.equal(
    inbox.length,
    1
  );

  const firstStep =
    started.history.find(
      entry =>
        entry.kind ===
          "effect_completed" &&
        entry.component ===
          "external-agent:existing"
    );

  assert.ok(firstStep);
  assert.equal(
    firstStep.output.type,
    "suspended"
  );
  assert.equal(
    firstStep.output.sessionRef.provider,
    "existing-agent-framework"
  );

  // Simulate an Agent process restart while UAIR is suspended. The new
  // runtime instance knows nothing except its own checkpoint directory;
  // UAIR will replay only the opaque sessionRef.
  const hostedFramework2 =
    new ExistingAgentFramework(
      "hosted-restarted",
      join(
        dir,
        "hosted-agent-checkpoints"
      )
    );

  activeHostedFramework =
    hostedFramework2;

  await service.resolve({
    interactionId:
      inbox[0].id,
    actor:
      "user:operator",
    value:
      approval
  });

  const completed =
    await resume(
      hostedWorkflow,
      started.id,
      storage
    );

  assert.equal(
    completed.status,
    "completed"
  );

  assert.deepEqual(
    completed.result,
    direct.output,
    "Agent output through UAIR must match direct execution semantics"
  );

  assert.equal(
    hostedFramework1.skillCalls +
      hostedFramework2.skillCalls,
    directFramework.skillCalls,
    "UAIR hosting must not reduce or duplicate Skill execution"
  );

  const hostedSession =
    await hostedFramework2
      .getState(
        firstStep.output.sessionRef
      );

  assert.equal(
    hostedSession.memory.includes(
      hostedFramework2.privateMemorySeed
    ),
    true,
    "external Agent memory must remain owned by its framework"
  );

  assert.equal(
    hostedFramework2
      .skillRegistry()
      .has(
        "domain-calculator"
      ),
    true,
    "external Agent Skill registry must remain intact after runtime restart"
  );

  const historyText =
    JSON.stringify(
      completed.history
    );

  assert.equal(
    historyText.includes(
      hostedFramework2.privateMemorySeed
    ),
    false,
    "UAIR History must not copy private Agent memory"
  );

  assert.equal(
    historyText.includes(
      hostedFramework2.privateSkillInstruction
    ),
    false,
    "UAIR History must not copy Skill instructions"
  );

  assert.equal(
    historyText.includes(
      "existing-agent-system-context"
    ),
    false,
    "UAIR History must not copy the Agent's internal prompt/context"
  );

  // ------------------------------------------------------------------
  // 2. Existing Agent remains outer orchestrator and calls UAIR Workflow.
  // ------------------------------------------------------------------
  const toolStorage =
    new JsonFileStorage(
      join(
        dir,
        "tool-runtime"
      )
    );

  let commitCalls = 0;

  const commitOrder =
    component(
      "commerce.order.commit",
      async input => {
        commitCalls += 1;
        return {
          orderId:
            `order:${input.sku}`,
          status:
            "committed"
        };
      }
    );

  const checkout =
    workflow(
      "commerce.checkout",
      async input =>
        commitOrder(
          input
        )
    );

  const checkoutTool =
    durableWorkflowTool(
      checkout,
      toolStorage
    );

  const outerAgent = {
    messages: [
      "SYSTEM_PRIVATE::shopping-agent-context",
      "USER::buy tea"
    ],
    memory: [
      "PRIVATE_OUTER_MEMORY::prefers-fast-checkout"
    ],
    skills: new Map([
      [
        "checkout",
        checkoutTool
      ],
      [
        "format-receipt",
        value =>
          `receipt:${value}`
      ]
    ])
  };

  const beforeSkillNames =
    [...outerAgent.skills.keys()];

  const toolResult =
    await outerAgent.skills
      .get("checkout")
      .start({
        sku: "tea"
      });

  assert.equal(
    toolResult.status,
    "completed"
  );

  outerAgent.messages.push(
    `TOOL_RESULT::${toolResult.result.orderId}`
  );

  const formatted =
    outerAgent.skills
      .get("format-receipt")(
        toolResult.result.orderId
      );

  assert.equal(
    formatted,
    "receipt:order:tea"
  );

  assert.deepEqual(
    [...outerAgent.skills.keys()],
    beforeSkillNames,
    "calling UAIR as a tool must not replace the Agent's Skill registry"
  );

  assert.equal(
    outerAgent.memory[0],
    "PRIVATE_OUTER_MEMORY::prefers-fast-checkout"
  );

  assert.equal(
    commitCalls,
    1
  );

  const executions =
    await toolStorage
      .listExecutions();

  assert.equal(
    executions.length,
    1
  );

  const toolHistory =
    JSON.stringify(
      executions[0].history
    );

  assert.equal(
    toolHistory.includes(
      "SYSTEM_PRIVATE::shopping-agent-context"
    ),
    false
  );

  assert.equal(
    toolHistory.includes(
      "PRIVATE_OUTER_MEMORY::prefers-fast-checkout"
    ),
    false
  );

  console.log(
    JSON.stringify(
      {
        mode1_uairHostsAgent: {
          baselineMatches:
            true,
          skillCallsDirect:
            directFramework.skillCalls,
          skillCallsHosted:
            hostedFramework1.skillCalls +
            hostedFramework2.skillCalls,
          privateMemoryCopiedToUair:
            false,
          privateContextCopiedToUair:
            false,
          privateSkillStateCopiedToUair:
            false
        },
        mode2_agentCallsUair: {
          workflow:
            checkoutTool.id,
          status:
            toolResult.status,
          outerMemoryPreserved:
            true,
          outerSkillsPreserved:
            true
        },
        mode3_suspendResume: {
          opaqueSessionRefPersisted:
            true,
          agentRuntimeRestarted:
            true,
          externalMemoryRecovered:
            completed.result.remembersPreference,
          externalSkillRecovered:
            completed.result.skillStillInstalled,
          finalEqualsDirect:
            true
        }
      },
      null,
      2
    )
  );

  console.log(
    "UAIR Agent boundary / Memory / Skill compatibility verification: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
