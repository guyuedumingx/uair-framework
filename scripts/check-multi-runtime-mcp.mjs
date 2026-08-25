import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const example = join(root, "examples", "multi-runtime-mcp", "dist");
const companyEntry = join(example, "company-server.js");
const agentEntry = join(example, "agent-client.js");
const localEntry = join(example, "local-server.js");
const temp = await mkdtemp(join(tmpdir(), "uair-multi-runtime-"));
const localData = join(temp, "personal");
const companyData = join(temp, "company");
const stateFile = join(temp, "agent", "handles.json");
const token = "signed-test-token.employee-1";
const children = new Set();

function childEnv(extra = {}) {
  return {
    ...process.env,
    ...extra
  };
}

function stop(child) {
  if (child && child.exitCode === null) child.kill("SIGTERM");
}

async function startCompany() {
  const child = spawn(process.execPath, [companyEntry], {
    cwd: root,
    env: childEnv({
      UAIR_DATA_DIR: companyData,
      UAIR_TEST_BEARER_TOKEN: token,
      PORT: "0"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  const ready = await new Promise((resolveReady, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`Company readiness timeout: ${stderr}`)), 5000);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Company exited before readiness (${code}): ${stderr}`));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      resolveReady(JSON.parse(stdout.slice(0, newline)));
    });
  });
  return { child, port: ready.port };
}

async function runAgent(mode, port) {
  const args = [agentEntry, mode];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: childEnv({
      UAIR_LOCAL_SERVER: localEntry,
      UAIR_LOCAL_DATA: localData,
      UAIR_AGENT_STATE: stateFile,
      ...(port ? {
        UAIR_COMPANY_URL: `http://127.0.0.1:${port}/mcp`,
        UAIR_TEST_BEARER_TOKEN: token
      } : {})
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise(resolveExit => child.once("exit", resolveExit));
  children.delete(child);
  assert.equal(code, 0, `Agent ${mode} failed: ${stderr}`);
  const lines = stdout.trim().split("\n").filter(Boolean);
  return JSON.parse(lines.at(-1));
}

async function scenario() {
  let company = await startCompany();
  const endpoint = `http://127.0.0.1:${company.port}/mcp`;
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { authorization: "Bearer invalid" },
    body: "{}"
  })).status, 401);
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      origin: "https://attacker.example"
    },
    body: "{}"
  })).status, 403);
  const initial = await runAgent("both", company.port);
  assert.deepEqual(initial.map(item => item.source), ["personal", "company"]);
  assert.notEqual(initial[0].executionId, initial[1].executionId);
  assert.equal(initial[0].workflowId, "personal.reminder.create");
  assert.equal(initial[1].workflowId, "hr.leave.request");

  const companyFiles = await readdir(join(companyData, "executions"));
  assert.equal(companyFiles.length, 1, "Company execution must survive client disconnect");
  const companyExecution = JSON.parse(await readFile(join(companyData, "executions", companyFiles[0]), "utf8"));
  assert.equal(companyExecution.status, "completed");
  assert.equal(JSON.stringify(companyExecution).includes(token), false);
  const persistedHandles = JSON.parse(await readFile(stateFile, "utf8"));
  assert.deepEqual(Object.keys(persistedHandles[0]).sort(), [
    "executionId", "source", "status", "workflowId"
  ]);

  stop(company.child);
  children.delete(company.child);
  const localOnly = await runAgent("local-only");
  assert.equal(localOnly[0].source, "personal");
  assert.equal(localOnly[0].workflowId, "personal.reminder.create");

  company = await startCompany();
  const reread = await runAgent("read-company", company.port);
  assert.equal(reread[0].executionId, initial[1].executionId);
  stop(company.child);
  children.delete(company.child);

  const personalFiles = await readdir(join(localData, "executions"));
  for (const filename of personalFiles) {
    const contents = await readFile(join(localData, "executions", filename), "utf8");
    assert.equal(contents.includes("hr.leave.request"), false);
  }
}

let timeout;
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Multi-runtime scenario exceeded 20 seconds")),
        20_000
      );
    })
  ]);
} finally {
  clearTimeout(timeout);
  for (const child of children) stop(child);
}

console.log("UAIR MCP multi-runtime cross-process verification: PASS");
