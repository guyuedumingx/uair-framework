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
  workflow,
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  agent,
  asAgentTool
} from "../packages/agent/dist/index.js";

let calls = 0;

const search = Object.assign(
  async input => {
    calls += 1;

    return {
      query:
        input?.query
    };
  },
  {
    kind:
      "component",
    id:
      "search",
    componentName:
      "search"
  }
);

const tool =
  asAgentTool(
    search,
    {
      parseArgs(value) {
        if (
          !value ||
          typeof value !==
            "object" ||
          typeof value.query !==
            "string"
        ) {
          throw new Error(
            "query must be a string"
          );
        }

        return {
          query:
            value.query
        };
      }
    }
  );

class InvalidModel {
  async decide() {
    return {
      type:
        "tool",
      tool:
        search.id,
      args: {
        query: 123
      }
    };
  }
}

const invalidAgent =
  agent(
    "validation",
    new InvalidModel(),
    [
      tool
    ],
    {
      maxSteps: 1
    }
  );

const invalidWorkflow =
  workflow({
    id:
      "validation.invalid",

    async run() {
      return invalidAgent(
        undefined
      );
    }
  });

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-agent-validation-"
    )
  );

try {
  const storage =
    new JsonFileStorage(
      join(
        dir,
        "state"
      )
    );

  let rejected =
    false;

  try {
    await run(
      invalidWorkflow,
      undefined,
      storage
    );
  } catch (
    error
  ) {
    rejected =
      String(
        error?.message
      ).includes(
        "query must be a string"
      );
  }

  assert.equal(
    rejected,
    true
  );

  assert.equal(
    calls,
    0,
    "invalid model arguments must be rejected before tool execution"
  );

  console.log(
    "UAIR Agent runtime argument validation check: PASS"
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
