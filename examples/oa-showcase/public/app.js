const $ =
  selector =>
    document.querySelector(
      selector
    );

const startButton =
  $("#startButton");

const approveButton =
  $("#approveButton");

const rejectButton =
  $("#rejectButton");

const newButton =
  $("#newButton");

let currentExecutionId =
  null;

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");
}

function money(value) {
  return Number(value)
    .toLocaleString(
      "zh-CN",
      {
        style:
          "currency",
        currency:
          "CNY",
        maximumFractionDigits: 0
      }
    );
}

function renderTrace(
  state
) {
  const trace =
    $("#traceList");

  if (
    !state.timeline ||
    state.timeline.length === 0
  ) {
    trace.innerHTML = `
      <div class="trace-empty">
        <div>⌁</div>
        <span>执行轨迹将在这里实时出现</span>
      </div>
    `;

    return;
  }

  trace.innerHTML =
    state.timeline
      .map(
        item => `
          <div class="trace-item ${item.status === "waiting" ? "waiting" : ""}">
            <strong>${escapeHtml(item.component)}</strong>
            <div class="trace-meta">
              <span>${escapeHtml(item.status)}</span>
              <span>${item.durationMs == null ? "—" : `${item.durationMs}ms`}</span>
            </div>
          </div>
        `
      )
      .join("");
}

function renderAnalysis(
  state
) {
  const execution =
    state.execution;

  if (!execution) {
    return;
  }

  $("#analysisEmpty")
    .classList
    .add("hidden");

  $("#analysisContent")
    .classList
    .remove("hidden");

  const pending =
    state.pendingUi;

  const suspension =
    execution.history
      .find(
        entry =>
          entry.kind ===
          "suspension_created"
      );

  const uiInput =
    suspension?.input;

  const ai =
    uiInput?.ai ??
    execution.result?.ai;

  const policy =
    uiInput?.policy ??
    execution.result?.policy;

  const budget =
    uiInput?.budget ??
    execution.result?.budget;

  const analysis =
    ai?.analysis;

  const risk =
    analysis?.risk ??
    "medium";

  const score =
    risk === "low"
      ? 94
      : risk === "high"
        ? 46
        : 82;

  $("#riskBadge")
    .textContent =
      risk.toUpperCase();

  $("#riskBadge")
    .className =
      `risk ${risk}`;

  $("#scoreValue")
    .textContent =
      String(score);

  $("#memoText")
    .textContent =
      ai?.draft?.memo ??
      "AI 分析已完成，等待审批。";

  $("#policyText")
    .textContent =
      policy?.policy ??
      "FIN-EXP-2026";

  $("#budgetText")
    .textContent =
      money(
        budget
          ?.monthlyRemaining ??
        42800
      );

  $("#routeText")
    .textContent =
      (
        analysis
          ?.recommendedRoute ??
        ["manager"]
      )
        .map(
          item =>
            item === "finance"
              ? "财务复核"
              : "直属经理"
        )
        .join(" → ");

  $("#reasonList")
    .innerHTML =
      (
        analysis
          ?.reasons ??
        []
      )
        .map(
          reason =>
            `<div class="reason">${escapeHtml(reason)}</div>`
        )
        .join("");

  $("#approvalCard")
    .classList
    .toggle(
      "hidden",
      !pending
    );

  $("#completedCard")
    .classList
    .toggle(
      "hidden",
      execution.status !==
        "completed"
    );

  if (
    execution.status ===
      "completed"
  ) {
    const decision =
      execution
        .result
        ?.decision;

    $("#completedText")
      .textContent =
        decision?.approved
          ? `已批准，审计记录 ${execution.result?.audit?.auditId ?? "已生成"}`
          : "申请已退回，审计记录已生成。";
  }
}

function renderMeta(
  state
) {
  const meta =
    state.meta;

  if (!meta) {
    return;
  }

  $("#runtimeMeta")
    .classList
    .remove("hidden");

  $("#metaWorkflow")
    .textContent =
      meta.workflow;

  $("#metaVersion")
    .textContent =
      meta.version ??
      "1";

  $("#metaFingerprint")
    .textContent =
      meta.fingerprint;

  $("#metaHistory")
    .textContent =
      `${meta.historyEvents} events`;
}

function renderStatus(
  state
) {
  const status =
    state.execution
      ?.status ??
    "idle";

  const executionStatus =
    $("#executionStatus");

  executionStatus
    .textContent =
      status.toUpperCase();

  executionStatus
    .className =
      `pill ${status}`;

  const requestStatus =
    $("#requestStatus");

  requestStatus
    .textContent =
      (
        status ===
          "idle"
          ? "DRAFT"
          : status
      )
        .toUpperCase();

  requestStatus
    .className =
      `pill ${status === "idle" ? "draft" : status}`;
}

function render(
  state
) {
  if (
    state.execution
  ) {
    currentExecutionId =
      state.execution.id;
    sessionStorage.setItem("uair:executionId", currentExecutionId);
  }

  renderStatus(state);
  renderTrace(state);
  renderAnalysis(state);
  renderMeta(state);
  updateFlow(state);
}

async function start() {
  startButton.disabled =
    true;

  startButton
    .querySelector("span")
    .textContent =
      "AI 审查中…";

  try {
    const state =
      await request(
        "/api/start",
        {
          method:
            "POST",
          body:
            JSON.stringify({
              applicant:
                "王小宇",
              department:
                "产品与智能化部",
              title:
                $("#titleInput")
                  .value,
              amount:
                Number(
                  $("#amountInput")
                    .value
                ),
              category:
                $("#categoryInput")
                  .value,
              description:
                $("#descriptionInput")
                  .value
            })
        }
      );

    render(state);
  } catch (error) {
    alert(error.message);
  } finally {
    startButton.disabled =
      false;

    startButton
      .querySelector("span")
      .textContent =
        "提交并启动 Workflow";
  }
}

async function decide(
  approved
) {
  if (!currentExecutionId) {
    return;
  }

  approveButton.disabled =
    true;

  rejectButton.disabled =
    true;

  try {
    const state =
      await request(
        "/api/decision",
        {
          method:
            "POST",
          body:
            JSON.stringify({
              executionId:
                currentExecutionId,
              approved,
              comment:
                $("#commentInput")
                  .value
            })
        }
      );

    render(state);
  } catch (error) {
    alert(error.message);
  } finally {
    approveButton.disabled =
      false;

    rejectButton.disabled =
      false;
  }
}

function reset() {
  currentExecutionId =
    null;

  $("#analysisContent")
    .classList
    .add("hidden");

  $("#analysisEmpty")
    .classList
    .remove("hidden");

  $("#runtimeMeta")
    .classList
    .add("hidden");

  $("#traceList")
    .innerHTML = `
      <div class="trace-empty">
        <div>⌁</div>
        <span>执行轨迹将在这里实时出现</span>
      </div>
    `;

  renderStatus({
    execution: null
  });
}

startButton
  .addEventListener(
    "click",
    start
  );

approveButton
  .addEventListener(
    "click",
    () =>
      decide(true)
  );

rejectButton
  .addEventListener(
    "click",
    () =>
      decide(false)
  );

newButton
  .addEventListener(
    "click",
    reset
  );

const enterDemo = $("#enterDemo");
if (enterDemo) enterDemo.addEventListener("click", () => $("#demoIntro").classList.add("out"));

function updateFlow(state) {
  const status = state.execution?.status ?? "idle";
  const pending = Boolean(state.pendingUi);
  const steps = [...document.querySelectorAll(".flow-step")];
  steps.forEach(x => x.classList.remove("active","done"));
  if (status === "idle") steps[0]?.classList.add("active");
  else if (pending) {
    steps[0]?.classList.add("done"); steps[1]?.classList.add("done"); steps[2]?.classList.add("active");
  } else if (status === "completed") {
    steps.forEach(x => x.classList.add("done"));
    steps[3]?.classList.add("active");
  } else { steps[0]?.classList.add("done"); steps[1]?.classList.add("active"); }
  $("#suspendBanner")?.classList.toggle("hidden", !pending);
  $("#commitFlash")?.classList.toggle("hidden", status !== "completed");
}

let lastBootId = sessionStorage.getItem("uair:lastBootId");
let runtimeWasOffline = false;
let healthTimer = null;

function setRuntimeBadge(mode, text) {
  const badge = $("#runtimeBadge");
  if (!badge) return;
  badge.className = `status-badge ${mode ?? ""}`;
  $("#runtimeStatusText").textContent = text;
}

function showOfflineToast() {
  if (document.querySelector(".runtime-offline-overlay")) return;
  const node = document.createElement("div");
  node.className = "runtime-offline-overlay";
  node.innerHTML = `<b>Runtime offline</b><span>不用担心：Suspension 已持久化。等待 Server 重启…</span>`;
  document.body.appendChild(node);
}

function hideOfflineToast() {
  document.querySelector(".runtime-offline-overlay")?.remove();
}

async function pollHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("offline");
    const health = await response.json();
    const changed = Boolean(lastBootId && lastBootId !== health.bootId);

    if (runtimeWasOffline || changed) {
      setRuntimeBadge("recovered", "Runtime recovered");
      $("#recoveryProof")?.classList.remove("hidden");
      if ($("#bootTransition")) {
        $("#bootTransition").textContent =
          `${lastBootId ? lastBootId.slice(-6) : "old"} → ${health.bootId.slice(-6)}`;
      }
      hideOfflineToast();

      if (currentExecutionId) {
        try {
          const state = await request(`/api/state?executionId=${encodeURIComponent(currentExecutionId)}`);
          render(state);
        } catch {}
      }

      setTimeout(() => setRuntimeBadge("", "Runtime online"), 3500);
    } else {
      setRuntimeBadge("", "Runtime online");
    }

    runtimeWasOffline = false;
    lastBootId = health.bootId;
    sessionStorage.setItem("uair:lastBootId", health.bootId);
  } catch {
    runtimeWasOffline = true;
    setRuntimeBadge("offline", "Runtime offline");
    showOfflineToast();
  }
}

healthTimer = setInterval(pollHealth, 1000);
pollHealth();

const originalUpdateFlow = updateFlow;
updateFlow = function(state) {
  originalUpdateFlow(state);
  $("#crashHint")?.classList.toggle("hidden", !state.pendingUi);
};

const rememberedExecution = sessionStorage.getItem("uair:executionId");
if (rememberedExecution) {
  currentExecutionId = rememberedExecution;
  request(`/api/state?executionId=${encodeURIComponent(rememberedExecution)}`)
    .then(render)
    .catch(() => {});
}
