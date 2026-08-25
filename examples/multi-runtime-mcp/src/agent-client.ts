import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import {
  dirname
} from "node:path";
import {
  JsonFileStorage
} from "@uair/core/runtime";
import {
  run,
  workflow
} from "@uair/core";
import {
  allowListedMcpStdioPolicy,
  connectMcpHttp,
  connectMcpStdio,
  createMcpCapabilitySet
} from "@uair/mcp";
import type {
  McpCallResult,
  McpExecutionHandle,
  McpServerAdapter
} from "@uair/mcp";

const [mode = "both"] = process.argv.slice(2);
const localServer = process.env.UAIR_LOCAL_SERVER;
const localData = process.env.UAIR_LOCAL_DATA;
const companyUrl = process.env.UAIR_COMPANY_URL;
const token = process.env.UAIR_TEST_BEARER_TOKEN;
const stateFile = process.env.UAIR_AGENT_STATE;
if (!localServer || !localData || !stateFile) throw new Error("Local server, data and Agent state are required");

const personal = await connectMcpStdio(
  "personal",
  {
    command: process.execPath,
    args: [localServer],
    env: {
      UAIR_DATA_DIR: localData,
      UAIR_PRINCIPAL_ID: "local-user"
    }
  },
  {
    processPolicy: allowListedMcpStdioPolicy([process.execPath])
  }
);

let company: McpServerAdapter | undefined;
if (companyUrl && token) {
  company = await connectMcpHttp("company", companyUrl, {
    connectionPolicy: { assertAllowed: url => {
      if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") {
        throw new Error("Reference company endpoint must be loopback HTTP");
      }
    } },
    requestInit: {
      headers: { authorization: `Bearer ${token}` }
    }
  });
}

const execute = workflow("example.multi-runtime.agent", async () => {
  const sources: Record<string, McpServerAdapter> = { personal };
  if (company) sources.company = company;
  const capabilities = await createMcpCapabilitySet(sources);
  if (mode === "read-company") {
    if (!company) throw new Error("Company Runtime is required to read its handle");
    const state = JSON.parse(await readFile(stateFile, "utf8")) as Array<{
      source: string;
      executionId: string;
    }>;
    const remote = state.find(item => item.source === "company");
    if (!remote) throw new Error("Stored company handle not found");
    const response = await company.tool("uair.execution.get")({
      executionId: remote.executionId
    });
    return [{
      source: "company",
      ...(response.structuredContent as McpExecutionHandle)
    }];
  }
  const reminderCapability = capabilities.get("personal:reminder.create");
  if (!reminderCapability?.invoke) throw new Error("Personal reminder capability missing");
  const reminder = await reminderCapability.invoke({
    at: "09:00",
    message: mode === "both" ? "Daily focus" : "Company offline"
  });
  const handles = [{
    source: "personal",
    ...((reminder as McpCallResult).structuredContent as McpExecutionHandle)
  }];
  if (mode === "both") {
    const leaveCapability = capabilities.get("company:leave.request");
    if (!leaveCapability?.invoke) throw new Error("Company leave capability missing");
    const leave = await leaveCapability.invoke({
      employeeId: "employee-1",
      date: "2026-08-24"
    });
    handles.push({
      source: "company",
      ...((leave as McpCallResult).structuredContent as McpExecutionHandle)
    });
  }
  return handles;
});
const execution = await run(
  execute,
  undefined,
  new JsonFileStorage(`${stateFile}.execution`)
);
const handles = execution.result as Array<{
  source: string;
} & McpExecutionHandle>;
if (mode === "both") {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify(handles.map(item => ({
      source: item.source,
      executionId: item.executionId,
      workflowId: item.workflowId,
      status: item.status
    }))),
    "utf8"
  );
}
process.stdout.write(`${JSON.stringify(handles)}\n`);
await personal.close();
if (company) await company.close();
