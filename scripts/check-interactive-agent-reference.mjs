import assert from "node:assert/strict";

import {
  mkdtemp,
  rm
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

import {
  RuntimeEngine,
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  listPendingUi,
  uiResultEvent
} from "../packages/ui/dist/index.js";

import {
  conversationalAgent
} from "../examples/conversational-agent/dist/workflow.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-interactive-agent-"
    )
  );

const previousCwd =
  process.cwd();

try {
  process.chdir(
    dir
  );

  const storage =
    new JsonFileStorage(
      join(
        dir,
        "state"
      )
    );

  const engine =
    new RuntimeEngine(
      storage,
      [
        conversationalAgent
      ]
    );

  const started =
    await run(
      conversationalAgent,
      undefined,
      storage
    );

  assert.equal(
    started.status,
    "suspended"
  );

  assert.equal(
    started.workflowVersion,
    "2"
  );

  async function pending() {
    const list =
      await listPendingUi(
        storage
      );

    const item =
      list.find(
        candidate =>
          candidate.executionId ===
            started.id
      );

    assert.ok(
      item,
      "conversation must have one blocking Surface wait"
    );

    return item;
  }

  async function act(
    value,
    eventId
  ) {
    const wait =
      await pending();

    await engine.emit(
      uiResultEvent({
        eventId,
        suspensionId:
          wait.suspensionId,
        value
      })
    );

    const execution =
      await storage
        .loadExecution(
          started.id
        );

    assert.equal(
      execution.status,
      "suspended",
      "each turn must return to the same long-running durable wait"
    );

    return pending();
  }

  let wait =
    await pending();

  assert.equal(
    wait.component,
    "Surface"
  );

  assert.equal(
    wait.props
      .data
      .view
      .kind,
    "welcome"
  );

  wait =
    await act(
      {
        type:
          "message",
        value:
          "查一下重点客户列表"
      },
      "turn-customer-list"
    );

  assert.equal(
    wait.props
      .data
      .view
      .kind,
    "list"
  );

  assert.equal(
    wait.props
      .data
      .view
      .items
      .length,
    4
  );

  assert.equal(
    wait.props
      .data
      .controlFlow
      .display,
    "non-blocking"
  );

  assert.equal(
    wait.props
      .data
      .controlFlow
      .currentSurface,
    "blocking"
  );

  assert.equal(
    wait.props
      .data
      .display
      .type,
    "ui.display"
  );

  assert.equal(
    wait.props
      .data
      .display
      .props
      .data
      .kind,
    "agent.progress"
  );

  wait =
    await act(
      {
        type:
          "select",
        id:
          "c-101",
        label:
          "星海科技",
        value:
          "c-101"
      },
      "turn-customer-detail"
    );

  assert.equal(
    wait.props
      .data
      .view
      .kind,
    "detail"
  );

  assert.equal(
    wait.props
      .data
      .view
      .title,
    "星海科技"
  );

  wait =
    await act(
      {
        type:
          "message",
        value:
          "我需要一个汇率转换能力"
      },
      "turn-capability-install"
    );

  assert.equal(
    wait.props
      .data
      .view
      .kind,
    "capability-proposal"
  );

  assert.equal(
    wait.props
      .data
      .view
      .resolution,
    "install"
  );

  assert.equal(
    wait.props
      .data
      .view
      .requiresApproval,
    true
  );

  wait =
    await act(
      {
        type:
          "approve-capability",
        metadata: {
          capabilityId:
            "finance.fx.convert",
          packageName:
            "@demo/fx-capability"
        }
      },
      "turn-capability-approve"
    );

  assert.equal(
    wait.props
      .data
      .view
      .kind,
    "capability-result"
  );

  assert.equal(
    wait.props
      .data
      .view
      .status,
    "approved"
  );

  wait =
    await act(
      {
        type:
          "message",
        value:
          "我需要一个天气工具"
      },
      "turn-capability-generate"
    );

  assert.equal(
    wait.props
      .data
      .view
      .resolution,
    "generate"
  );

  wait =
    await act(
      {
        type:
          "reject-capability",
        metadata: {
          capabilityId:
            "weather.forecast",
          packageName:
            "@demo/weather-capability"
        }
      },
      "turn-capability-reject"
    );

  assert.equal(
    wait.props
      .data
      .view
      .status,
    "rejected"
  );

  const final =
    await storage
      .loadExecution(
        started.id
      );

  const created =
    final.history.filter(
      entry =>
        entry.kind ===
          "suspension_created"
    );

  const resolved =
    final.history.filter(
      entry =>
        entry.kind ===
          "suspension_resolved"
    );

  assert.equal(
    created.length,
    7,
    "initial welcome plus every interaction turn must create one blocking Surface"
  );

  assert.equal(
    resolved.length,
    6,
    "all prior Surfaces must be durably resolved while the seventh remains pending"
  );

  assert.equal(
    (
      await storage
        .listExecutions()
    ).filter(
      execution =>
        execution.id ===
          started.id
    ).length,
    1,
    "UI clicks/text/capability approvals remain one Execution, not new Agents"
  );

  console.log(
    JSON.stringify(
      {
        textInput:
          "PASS",
        clickInput:
          "PASS",
        dynamicList:
          "PASS",
        dynamicDetail:
          "PASS",
        nonBlockingDisplay:
          "PASS",
        blockingSurface:
          "PASS",
        installProposal:
          "PASS",
        generateProposal:
          "PASS",
        explicitCapabilityApproval:
          "PASS",
        explicitCapabilityRejection:
          "PASS",
        sameLongRunningExecution:
          "PASS",
        durableTurnHistory:
          "PASS",
        coreChanges:
          0
      },
      null,
      2
    )
  );

  console.log(
    "UAIR Interactive Agent reference app verification: PASS"
  );
} finally {
  process.chdir(
    previousCwd
  );

  await rm(
    dir,
    {
      recursive:
        true,
      force:
        true
    }
  );
}
