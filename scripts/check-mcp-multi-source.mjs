import assert from "node:assert/strict";
import { run, workflow } from "../packages/core/dist/index.js";
import { JsonFileStorage } from "../packages/core/dist/runtime-api.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpCapabilitySet } from "../packages/mcp/dist/index.js";

const calls = [];
const source = name => ({
  async listTools() {
    return [{ name: "calendar.create", description: `${name} calendar` }];
  },
  tool() {
    return async () => {
      calls.push(name);
      return { structuredContent: { accepted: true } };
    };
  }
});
const scenario = workflow("mcp.multi-source.check", async () => {
  const merged = await createMcpCapabilitySet({
    personal: source("personal"),
    company: source("company")
  });
  assert.deepEqual(
    merged.list().map(item => item.id).sort(),
    ["company:calendar.create", "personal:calendar.create"]
  );
  await merged.get("personal:calendar.create").invoke({ title: "Local" });
  await merged.get("company:calendar.create").invoke({ title: "Work" });
});
const dir = await mkdtemp(join(tmpdir(), "uair-mcp-sources-"));
await run(scenario, undefined, new JsonFileStorage(dir));
assert.deepEqual(calls, ["personal", "company"]);
await assert.rejects(
  createMcpCapabilitySet({ "bad:source": source("bad") }),
  /Invalid MCP source name/
);
console.log("UAIR MCP multi-source capability set: PASS");
