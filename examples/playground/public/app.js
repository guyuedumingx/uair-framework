const $ = selector =>
  document.querySelector(selector);

const taskInput =
  $("#taskInput");

const startButton =
  $("#startButton");

const refreshButton =
  $("#refreshButton");

const forkButton =
  document.createElement("button");

forkButton.className =
  "secondary";
forkButton.textContent =
  "Fork execution";

refreshButton
  .parentElement
  ?.appendChild(
    forkButton
  );

const timeline =
  $("#timeline");

const interaction =
  $("#interaction");

const nodeDetail =
  $("#nodeDetail");

const gantt =
  $("#gantt");

const timelineScale =
  $("#timelineScale");

const history =
  $("#history");

const statusPill =
  $("#statusPill");

const executionId =
  $("#executionId");

let currentExecutionId =
  null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function request(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "content-type":
            "application/json"
        },
        ...options
      }
    );

  const body =
    await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ??
      `HTTP ${response.status}`
    );
  }

  return body;
}

function stepLabel(entry) {
  if (
    entry.kind ===
      "effect_completed"
  ) {
    return {
      icon: "✓",
      className:
        "complete",
      title:
        entry.component,
      meta:
        `effect · ${entry.path}`,
      badge:
        `g${entry.generation}`
    };
  }

  if (
    entry.kind ===
      "suspension_created"
  ) {
    return {
      icon: "Ⅱ",
      className:
        "waiting",
      title:
        entry.component,
      meta:
        `suspended · ${entry.path}`,
      badge:
        `g${entry.generation}`
    };
  }

  if (
    entry.kind ===
      "suspension_resolved"
  ) {
    return {
      icon: "↳",
      className:
        "complete",
      title:
        "UI response",
      meta:
        entry.suspensionId,
      badge:
        "resolved"
    };
  }

  if (
    entry.kind ===
      "effect_attempt_failed"
  ) {
    return {
      icon: "!",
      className:
        "failed",
      title:
        entry.component,
      meta:
        entry.error?.message ??
        "attempt failed",
      badge:
        `attempt ${entry.attempt}`
    };
  }

  if (
    entry.kind ===
      "resume_requested"
  ) {
    return {
      icon: "↻",
      className:
        "complete",
      title:
        "Resume requested",
      meta:
        entry.reason,
      badge:
        "event"
    };
  }

  return {
    icon: "·",
    className: "",
    title:
      entry.kind,
    meta: "",
    badge: ""
  };
}

function flattenTree(nodes, depth = 0) {
  return nodes.flatMap(node => [
    { node, depth },
    ...flattenTree(node.children ?? [], depth + 1)
  ]);
}

function renderNodeDetail(node, selectedGeneration = null) {
  if (!node) {
    nodeDetail.className =
      "node-detail empty";
    nodeDetail.textContent =
      "点击一个节点查看 generation、retry、input/output，并可对 waiting Suspension 手工 resolve。";
    return;
  }

  const generation =
    selectedGeneration == null
      ? node.generations[
          node.generations.length - 1
        ]
      : node.generations.find(
          item =>
            item.generation ===
            selectedGeneration
        ) ??
        node.generations[
          node.generations.length - 1
        ];

  const generations =
    node.generations
      .map(
        item => `
          <button class="generation-row ${item.generation === generation.generation ? "active" : ""}" data-generation="${item.generation}">
            <strong>g${item.generation}</strong>
            <span>${escapeHtml(item.status)}</span>
            <span>${item.attempts.length} retries</span>
          </button>
        `
      )
      .join("");

  const resolveButton =
    generation.status ===
      "waiting" &&
    generation.suspensionId
      ? `<button id="manualResolveButton" class="approve">手工 Resolve</button>`
      : "";

  nodeDetail.className =
    "node-detail";

  nodeDetail.innerHTML = `
    <div class="eyebrow">Node detail</div>
    <h3>${escapeHtml(node.component)}</h3>
    <dl class="detail-grid">
      <dt>status</dt><dd>${escapeHtml(generation.status)}</dd>
      <dt>path</dt><dd>${escapeHtml(node.path)}</dd>
      <dt>generation</dt><dd>g${escapeHtml(generation.generation)}</dd>
      <dt>replayed</dt><dd>${node.replayed ? "yes" : "no"}</dd>
      <dt>effectId</dt><dd>${escapeHtml(generation.effectId ?? "—")}</dd>
      <dt>suspension</dt><dd>${escapeHtml(generation.suspensionId ?? "—")}</dd>
      <dt>attempts</dt><dd>${escapeHtml(generation.attempts?.length ?? 0)}</dd>
      <dt>startedAt</dt><dd>${generation.startedAt ? new Date(generation.startedAt).toLocaleTimeString() : "—"}</dd>
      <dt>completedAt</dt><dd>${generation.completedAt ? new Date(generation.completedAt).toLocaleTimeString() : "—"}</dd>
      <dt>duration</dt><dd>${escapeHtml(generation.durationMs == null ? "—" : `${generation.durationMs} ms`)}</dd>
    </dl>

    <div class="generation-list">
      ${generations}
    </div>

    ${resolveButton}

    <pre class="detail-json">${escapeHtml(JSON.stringify({
      input: generation.input,
      output: generation.output,
      attributes:
        generation.attributes,
      metrics:
        generation.metrics,
      attempts:
        generation.attempts
    }, null, 2))}</pre>
  `;

  nodeDetail
    .querySelectorAll(
      "[data-generation]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          () =>
            renderNodeDetail(
              node,
              Number(
                button.dataset.generation
              )
            )
        );
      }
    );

  const manual =
    $("#manualResolveButton");

  manual?.addEventListener(
    "click",
    async () => {
      const raw =
        prompt(
          "输入 resolve JSON",
          '{"approved":true,"comment":"manual debug resolve"}'
        );

      if (!raw) {
        return;
      }

      let value;

      try {
        value =
          JSON.parse(raw);
      } catch {
        alert(
          "JSON 格式不正确"
        );

        return;
      }

      try {
        const next =
          await request(
            "/api/suspension/resolve",
            {
              method:
                "POST",
              body:
                JSON.stringify({
                  suspensionId:
                    generation.suspensionId,
                  value
                })
            }
          );

        render(next);
      } catch (error) {
        alert(error.message);
      }
    }
  );
}

function renderGantt(tree) {
  const items =
    tree
      ? flattenTree(tree.roots ?? [])
      : [];

  const timed =
    items
      .map(({node, depth}) => {
        const current =
          node.generations[
            node.generations.length - 1
          ];

        const start =
          current.startedAt;

        const end =
          current.completedAt ??
          (
            current.status === "waiting"
              ? Date.now()
              : current.startedAt
          );

        return {
          node,
          depth,
          current,
          start,
          end
        };
      })
      .filter(
        item =>
          typeof item.start === "number" &&
          typeof item.end === "number"
      );

  if (timed.length === 0) {
    gantt.className =
      "gantt empty";
    gantt.textContent =
      "暂无时间数据。";
    timelineScale.textContent =
      "—";
    return;
  }

  const min =
    Math.min(
      ...timed.map(
        item => item.start
      )
    );

  const max =
    Math.max(
      ...timed.map(
        item => item.end
      )
    );

  const span =
    Math.max(
      1,
      max - min
    );

  timelineScale.textContent =
    `${span} ms`;

  gantt.className =
    "gantt";

  gantt.innerHTML =
    timed.map(
      item => {
        const left =
          (
            (
              item.start -
              min
            ) /
            span
          ) *
          100;

        const width =
          Math.max(
            1.5,
            (
              (
                item.end -
                item.start
              ) /
              span
            ) *
              100
          );

        const waiting =
          item.current.status ===
            "waiting";

        return `
          <div class="gantt-row">
            <div class="gantt-label" style="padding-left:${item.depth * 12}px">
              ${escapeHtml(item.node.component)}
            </div>
            <div class="gantt-track">
              <div
                class="gantt-bar ${waiting ? "waiting" : ""}"
                style="left:${left}%;width:${width}%"
                title="${escapeHtml(`${item.node.component}: ${item.end - item.start} ms`)}"
              ></div>
            </div>
            <div class="gantt-duration">${item.end - item.start} ms</div>
          </div>
        `;
      }
    )
    .join("");
}

function renderTimeline(execution, tree) {
  if (!execution || !tree) {
    timeline.className = "timeline empty";
    timeline.textContent =
      "启动一个 Workflow 后，这里会显示从 durable history 自动还原的执行树。";
    renderNodeDetail(null);
    return;
  }

  timeline.className = "timeline";
  const items = flattenTree(tree.roots ?? []);

  timeline.innerHTML = items.map(({node, depth}, index) => {
    const waiting = node.status === "waiting";
    const cls = waiting ? "waiting" : node.status === "failed" ? "failed" : "complete";
    const icon = waiting ? "Ⅱ" : node.status === "failed" ? "!" : "✓";
    return `
      <div class="tree-node ${index === 0 ? "selected" : ""}" style="--depth:${depth}" data-node-index="${index}">
        <button>
          <div class="step ${cls}">
            <div class="icon">${icon}</div>
            <div>
              <div class="step-title">${escapeHtml(node.component)}</div>
              <div class="step-meta">${escapeHtml(node.path)} · ${escapeHtml(node.kind)}</div>
            </div>
            <div class="badge">${node.replayed ? `replay · g${node.currentGeneration}` : escapeHtml(node.status)}</div>
          </div>
        </button>
      </div>`;
  }).join("");

  const select = index => {
    timeline.querySelectorAll(".tree-node").forEach(el => el.classList.remove("selected"));
    const el = timeline.querySelector(`[data-node-index="${index}"]`);
    el?.classList.add("selected");
    renderNodeDetail(items[index]?.node);
  };

  timeline.querySelectorAll("[data-node-index]").forEach(el => {
    el.addEventListener("click", () => select(Number(el.dataset.nodeIndex)));
  });

  renderNodeDetail(items[0]?.node ?? null);
}

function renderInteraction(
  state
) {
  const execution =
    state.execution;

  const pending =
    state.pendingUi?.[0];

  if (pending) {
    const proposal =
      pending.props?.proposal;

    interaction.className =
      "interaction";

    interaction.innerHTML = `
      <div class="card">
        <div class="eyebrow">Blocking UI</div>
        <h3>${escapeHtml(pending.component)}</h3>
        <p>Workflow 已暂停，必须由用户返回结果后才能继续。</p>
        <div class="proposal">${escapeHtml(JSON.stringify(proposal, null, 2))}</div>
        <div class="actions">
          <button class="approve" data-decision="approve">批准并继续</button>
          <button class="reject" data-decision="reject">拒绝</button>
        </div>
      </div>
    `;

    interaction
      .querySelectorAll(
        "[data-decision]"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            async () => {
              const approved =
                button.dataset
                  .decision ===
                  "approve";

              button.disabled =
                true;

              try {
                const next =
                  await request(
                    "/api/ui/resolve",
                    {
                      method:
                        "POST",
                      body:
                        JSON.stringify({
                          eventId:
                            `ui:${pending.suspensionId}:${approved}`,
                          suspensionId:
                            pending.suspensionId,
                          value: {
                            approved,
                            comment:
                              approved
                                ? "Approved in UAIR Playground"
                                : "Rejected in UAIR Playground"
                          }
                        })
                    }
                  );

                render(next);
              } catch (error) {
                alert(
                  error.message
                );
                button.disabled =
                  false;
              }
            }
          );
        }
      );

    return;
  }

  if (
    execution?.status ===
      "completed"
  ) {
    interaction.className =
      "interaction";

    interaction.innerHTML = `
      <div class="card result">
        <div class="success">✓ Workflow completed</div>
        <p>Agent 动态工作完成，审批结果已恢复，mandatory audit 已执行。</p>
        <div class="proposal">${escapeHtml(JSON.stringify(execution.result, null, 2))}</div>
      </div>
    `;

    return;
  }

  if (
    execution?.status ===
      "failed"
  ) {
    interaction.className =
      "interaction";

    interaction.innerHTML = `
      <div class="card result">
        <div class="success" style="color:#ff7c85">Workflow failed</div>
        <div class="proposal">${escapeHtml(JSON.stringify(execution.error, null, 2))}</div>
      </div>
    `;

    return;
  }

  interaction.className =
    "interaction empty";

  interaction.textContent =
    execution
      ? "当前没有等待中的 UI。"
      : "当前没有等待中的交互。";
}

function render(
  state
) {
  const execution =
    state.execution;

  if (execution) {
    currentExecutionId =
      execution.id;

    executionId.textContent =
      execution.id;

    statusPill.textContent =
      execution.status
        .toUpperCase();

    statusPill.className =
      `status ${execution.status}`;
  } else {
    statusPill.textContent =
      "IDLE";

    statusPill.className =
      "status idle";

    executionId.textContent =
      "—";
  }

  renderTimeline(
    execution,
    state.tree
  );

  renderInteraction(
    state
  );

  renderGantt(
    state.tree
  );

  history.textContent =
    JSON.stringify(
      execution ?? {},
      null,
      2
    );
}

async function refresh() {
  const query =
    currentExecutionId
      ? `?executionId=${encodeURIComponent(currentExecutionId)}`
      : "";

  render(
    await request(
      `/api/state${query}`
    )
  );
}

startButton.addEventListener(
  "click",
  async () => {
    startButton.disabled =
      true;

    startButton.textContent =
      "运行中…";

    try {
      const state =
        await request(
          "/api/start",
          {
            method:
              "POST",
            body:
              JSON.stringify({
                user:
                  "demo-user",
                task:
                  taskInput.value
              })
          }
        );

      render(state);
    } catch (error) {
      alert(error.message);
    } finally {
      startButton.disabled =
        false;

      startButton.textContent =
        "启动 Workflow";
    }
  }
);

refreshButton.addEventListener(
  "click",
  refresh
);

refresh().catch(
  console.error
);


forkButton.addEventListener(
  "click",
  async () => {
    if (!currentExecutionId) {
      alert(
        "当前没有可 Fork 的 Execution"
      );
      return;
    }

    forkButton.disabled = true;

    try {
      const next =
        await request(
          "/api/fork",
          {
            method:
              "POST",
            body:
              JSON.stringify({
                executionId:
                  currentExecutionId
              })
          }
        );

      render(next);
    } catch (error) {
      alert(error.message);
    } finally {
      forkButton.disabled =
        false;
    }
  }
);
