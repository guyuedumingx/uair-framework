const $ = s => document.querySelector(s);

let executionId = sessionStorage.getItem("uair:conversationExecution") || null;

async function request(url, options={}) {
  const response = await fetch(url, {
    headers: {"content-type":"application/json"},
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");
}

function renderTranscript(items) {
  const node = $("#transcript");
  if (!items?.length) {
    node.innerHTML = `<div class="empty"><span>⌁</span><p>每轮用户输入都会成为可恢复的执行位置。</p></div>`;
    return;
  }
  node.innerHTML = items.map(x => `
    <div class="msg ${x.role}">
      <small>${x.role === "user" ? "YOU" : "AGENT"}</small>
      ${esc(x.text)}
    </div>
  `).join("");
}

function renderView(view) {
  const body = $("#surfaceBody");
  $("#surfaceTitle").textContent = view?.title || "Agent";
  $("#surfaceKind").textContent = (view?.kind || "WAITING").toUpperCase();

  if (!view) {
    body.innerHTML = `<div class="message-card"><p>等待下一轮输入…</p></div>`;
    return;
  }

  if (view.kind === "welcome") {
    body.innerHTML = `
      <div class="message-card">
        <div class="eyebrow">READY</div>
        <h3 class="view-title">${esc(view.title)}</h3>
        <p>输入文字、使用语音，或点击下面的快捷指令。</p>
      </div>`;
    const suggestions = $("#suggestions");
    suggestions.classList.remove("hidden");
    suggestions.innerHTML = view.suggestions.map(x =>
      `<button class="suggestion" data-message="${esc(x)}">${esc(x)}</button>`
    ).join("");
    suggestions.querySelectorAll("[data-message]").forEach(btn => {
      btn.addEventListener("click", () => sendMessage(btn.dataset.message));
    });
    return;
  }

  $("#suggestions").classList.add("hidden");

  if (view.kind === "list") {
    body.innerHTML = `
      <h3 class="view-title">${esc(view.title)}</h3>
      <div class="view-subtitle">${esc(view.subtitle)}</div>
      <div class="list-grid">
        ${view.items.map(item => `
          <button class="list-item" data-select="${esc(item.id)}" data-label="${esc(item.title)}">
            <div><b>${esc(item.title)}</b><span>${esc(item.meta)}</span></div>
            <em>${esc(item.value)}</em>
          </button>
        `).join("")}
      </div>`;
    body.querySelectorAll("[data-select]").forEach(btn => {
      btn.addEventListener("click", () => sendAction({
        type:"select",
        id:btn.dataset.select,
        label:btn.dataset.label,
        value:btn.dataset.select
      }));
    });
    return;
  }

  if (view.kind === "detail") {
    body.innerHTML = `
      <div class="detail-card">
        <div class="eyebrow">CUSTOMER DETAIL</div>
        <h3 class="view-title">${esc(view.title)}</h3>
        <div class="detail-grid">
          ${view.fields.map(f => `<div class="detail-field"><span>${esc(f.label)}</span><b>${esc(f.value)}</b></div>`).join("")}
        </div>
        <div class="action-row">
          ${view.actions.map(a => `<button data-message="${esc(a)}">${esc(a)}</button>`).join("")}
        </div>
      </div>`;
    body.querySelectorAll("[data-message]").forEach(btn => btn.addEventListener("click",()=>sendMessage(btn.dataset.message)));
    return;
  }

  if (view.kind === "capability-proposal") {
    body.innerHTML = `
      <div class="forge-card">
        <div class="eyebrow">CAPABILITY ${esc(view.resolution).toUpperCase()} PROPOSAL</div>
        <h3 class="view-title">${esc(view.title)}</h3>
        <div class="view-subtitle">这是一个需要显式授权的扩展提议，不是自动安装。</div>
        <div class="forge-id">
          <span>capability</span><code>${esc(view.capabilityId)}</code>
          <span>package</span><code>${esc(view.packageName)}@${esc(view.packageVersion)}</code>
        </div>
        <div class="forge-steps">
          ${view.steps.map(s => `<div class="forge-step ${s.status}"><span>${esc(s.label)}</span><em>${s.status.toUpperCase()}</em></div>`).join("")}
        </div>
        <div class="forge-note">${esc(view.note)}</div>
        <div class="approval-row">
          <button id="rejectCapability" class="secondary-action">拒绝</button>
          <button id="approveCapability" class="primary-action">批准扩展</button>
        </div>
      </div>`;

    $("#approveCapability").addEventListener("click", () => sendAction({
      type:"approve-capability",
      metadata:{
        capabilityId:view.capabilityId,
        packageName:view.packageName
      }
    }));

    $("#rejectCapability").addEventListener("click", () => sendAction({
      type:"reject-capability",
      metadata:{
        capabilityId:view.capabilityId,
        packageName:view.packageName
      }
    }));

    return;
  }

  if (view.kind === "capability-result") {
    body.innerHTML = `
      <div class="message-card capability-result ${esc(view.status)}">
        <div class="eyebrow">EXTENSION ${esc(view.status).toUpperCase()}</div>
        <h3 class="view-title">${esc(view.title)}</h3>
        <p>${esc(view.text)}</p>
        <div class="result-meta">
          <code>${esc(view.capabilityId)}</code>
          <span>${esc(view.packageName)}</span>
        </div>
      </div>`;
    return;
  }

  body.innerHTML = `
    <div class="message-card">
      <div class="eyebrow">AGENT RESPONSE</div>
      <h3 class="view-title">${esc(view.title)}</h3>
      <p>${esc(view.text)}</p>
    </div>`;
}


function renderAmbient(display) {
  const node = $("#ambientSurface");

  if (!display?.props?.data) {
    node.classList.add("hidden");
    node.innerHTML = "";
    return;
  }

  const data = display.props.data;
  node.classList.remove("hidden");
  node.innerHTML = `
    <div class="ambient-card ${esc(data.tone || "info")}">
      <small>NON-BLOCKING DISPLAY</small>
      <b>${esc(data.title)}</b>
      <span>${esc(data.text)}</span>
    </div>`;
}

function renderRuntime(state) {
  const runtime = state.runtime;
  $("#runtimeStatus").textContent = runtime?.status?.toUpperCase() || "IDLE";

  const facts = $("#runtimeFacts");
  const values = runtime
    ? [
        ["Workflow", runtime.workflow],
        ["Version", runtime.workflowVersion],
        ["Revision", runtime.revision],
        ["History", runtime.historyEvents]
      ]
    : [
        ["Workflow", "—"],
        ["Version", "—"],
        ["Revision", "—"],
        ["History", "—"]
      ];

  facts.innerHTML = values.map(([label,value]) => `
    <div><span>${esc(label)}</span><b>${esc(value)}</b></div>
  `).join("");

  const timeline = $("#runtimeTimeline");
  if (!state.timeline?.length) {
    timeline.innerHTML = `<div class="timeline-empty">启动后显示最近的 durable events</div>`;
    return;
  }

  timeline.innerHTML = state.timeline.slice().reverse().map(event => `
    <div class="timeline-event">
      <span>${esc(event.kind)}</span>
      <b>${esc(event.component || event.path || "workflow")}</b>
    </div>
  `).join("");
}

function render(state) {
  executionId = state.execution?.id || executionId;
  if (executionId) sessionStorage.setItem("uair:conversationExecution", executionId);
  $("#turnBadge").textContent = `TURN ${state.turn ?? 0}`;
  renderTranscript(state.transcript || []);
  renderView(state.view);
  renderAmbient(state.display);
  renderRuntime(state);
  $("#inputDock").classList.toggle("hidden", !state.pendingUi);
}

async function start() {
  const state = await request("/api/start", {method:"POST",body:"{}"});
  render(state);
}

async function sendAction(action) {
  if (!executionId) return;
  $("#sendButton").disabled = true;
  try {
    const state = await request("/api/action", {
      method:"POST",
      body:JSON.stringify({executionId, action})
    });
    render(state);
  } catch (e) {
    alert(e.message);
  } finally {
    $("#sendButton").disabled = false;
  }
}

async function sendMessage(text) {
  const value = (text ?? $("#commandInput").value).trim();
  if (!value) return;
  $("#commandInput").value = "";
  await sendAction({
    type:"message",
    value
  });
}

$("#startButton").addEventListener("click", start);
$("#sendButton").addEventListener("click", () => sendMessage());
$("#commandInput").addEventListener("keydown", e => {
  if (e.key === "Enter") sendMessage();
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener("start", () => $("#micButton").classList.add("listening"));
  recognition.addEventListener("end", () => $("#micButton").classList.remove("listening"));
  recognition.addEventListener("result", event => {
    const text = event.results[0][0].transcript;
    $("#commandInput").value = text;
    sendMessage(text);
  });

  $("#micButton").addEventListener("click", () => recognition.start());
} else {
  $("#micButton").title = "当前浏览器不支持语音识别";
  $("#micButton").disabled = true;
}

if (executionId) {
  request(`/api/state?executionId=${encodeURIComponent(executionId)}`)
    .then(render)
    .catch(() => {
      executionId = null;
      sessionStorage.removeItem("uair:conversationExecution");
    });
}
