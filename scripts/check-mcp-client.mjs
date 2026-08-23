import assert from "node:assert/strict";
import {
  mkdtemp
} from "node:fs/promises";
import {
  tmpdir
} from "node:os";
import {
  join
} from "node:path";
import {
  run,
  workflow
} from "../packages/core/dist/index.js";
import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";
import {
  McpToolError,
  mcp
} from "../packages/mcp/dist/index.js";

const calls = [];
const adapter = mcp("company", {
  async listTools() {
    return {
      tools: [
        {
          name: "leave.request",
          inputSchema: {
            type: "object"
          }
        }
      ]
    };
  },

  async callTool(request) {
    calls.push(request);

    if (request.name === "fail") {
      return {
        isError: true,
        content: []
      };
    }

    return {
      structuredContent: {
        accepted: true
      }
    };
  }
});

const scenario =
  workflow(
    "mcp.client.characterization",
    async () => ({
      tools:
        await adapter.listTools(),
      result:
        await adapter.call(
          "leave.request",
          {
            days: 1
          }
        )
    })
  );

const storageDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-mcp-client-"
    )
  );

const execution =
  await run(
    scenario,
    undefined,
    new JsonFileStorage(
      storageDir
    )
  );

assert.deepEqual(
  execution.result,
  {
    tools: [
      {
        name:
          "leave.request",
        inputSchema: {
          type:
            "object"
        }
      }
    ],
    result: {
      structuredContent: {
        accepted: true
      }
    }
  }
);

assert.deepEqual(
  calls,
  [
    {
      name: "leave.request",
      arguments: {
        days: 1
      }
    }
  ]
);

const failing =
  workflow(
    "mcp.client.error",
    () =>
      adapter.call(
        "fail"
      )
  );

await assert.rejects(
  run(
    failing,
    undefined,
    new JsonFileStorage(
      `${storageDir}-error`
    )
  ),
  McpToolError
);

console.log(
  "UAIR MCP client characterization: PASS"
);
