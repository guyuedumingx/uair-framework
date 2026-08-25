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
  component,
  workflow,
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  agent,
  asAgentTool,
  jsonAgentModel,
  parseAgentAction
} from "../packages/agent/dist/index.js";

assert.deepEqual(
  parseAgentAction({
    type:
      "tool",
    tool:
      "search",
    args: {
      query:
        "uair"
    },
    ignored:
      "provider-metadata"
  }),
  {
    type:
      "tool",
    tool:
      "search",
    args: {
      query:
        "uair"
    }
  }
);

assert.deepEqual(
  parseAgentAction({
    type:
      "final",
    value:
      undefined
  }),
  {
    type:
      "final",
    value:
      undefined
  }
);

for (
  const invalid
  of [
    null,
    [],
    {},
    {
      type:
        "tool",
      tool:
        ""
    },
    {
      type:
        "tool",
      tool:
        "search",
      args: []
    },
    {
      type:
        "final"
    }
  ]
) {
  assert.throws(
    () =>
      parseAgentAction(
        invalid
      ),
    TypeError
  );
}

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

class MalformedActionModel {
  async decide() {
    return {
      type:
        "tool",
      tool:
        search.id,
      args: []
    };
  }
}

const malformedActionAgent =
  agent(
    "malformed-action",
    new MalformedActionModel(),
    [
      tool
    ]
  );

const malformedActionWorkflow =
  workflow(
    "validation.malformed-action",
    async () =>
      malformedActionAgent(
        undefined
      )
  );

const invalidJsonComponent =
  component(
    "validation.model.invalid-json",
    async () =>
      "not-json"
  );

const invalidJsonAgent =
  agent(
    "invalid-json",
    jsonAgentModel(
      invalidJsonComponent
    ),
    []
  );

const invalidJsonWorkflow =
  workflow(
    "validation.invalid-json",
    async () =>
      invalidJsonAgent(
        undefined
      )
  );

let actionParserCalls =
  0;

const customSchemaComponent =
  component(
    "validation.model.custom-schema",
    async () =>
      JSON.stringify({
        kind:
          "done",
        payload:
          42
      })
  );

const customSchemaAgent =
  agent(
    "custom-schema",
    jsonAgentModel(
      customSchemaComponent,
      {
        parseAction(value) {
          actionParserCalls +=
            1;

          if (
            !value ||
            typeof value !==
              "object" ||
            value.kind !==
              "done"
          ) {
            throw new Error(
              "unexpected custom model response"
            );
          }

          return {
            type:
              "final",
            value:
              value.payload
          };
        }
      }
    ),
    []
  );

const customSchemaWorkflow =
  workflow(
    "validation.custom-schema",
    async () =>
      customSchemaAgent(
        undefined
      )
  );

let agentOptionParserCalls =
  0;

const agentOptionParserAgent =
  agent(
    "agent-option-schema",
    {
      async decide() {
        return {
          kind:
            "done",
          payload:
            7
        };
      }
    },
    [],
    {
      parseAction(value) {
        agentOptionParserCalls +=
          1;

        if (
          !value ||
          typeof value !==
            "object" ||
          value.kind !==
            "done"
        ) {
          throw new Error(
            "unexpected AgentModel response"
          );
        }

        return {
          type:
            "final",
          value:
            value.payload
        };
      }
    }
  );

const agentOptionParserWorkflow =
  workflow(
    "validation.agent-option-schema",
    async () =>
      agentOptionParserAgent(
        undefined
      )
  );

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

  await assert.rejects(
    run(
      malformedActionWorkflow,
      undefined,
      storage
    ),
    /Agent tool action\.args must be an object/
  );

  assert.equal(
    calls,
    0,
    "malformed Agent actions must be rejected before tool execution"
  );

  await assert.rejects(
    run(
      invalidJsonWorkflow,
      undefined,
      storage
    ),
    /Agent model returned invalid JSON/
  );

  const customResult =
    await run(
      customSchemaWorkflow,
      undefined,
      storage
    );

  assert.equal(
    customResult.status,
    "completed"
  );

  assert.equal(
    customResult.result,
    42
  );

  assert.equal(
    actionParserCalls,
    1,
    "custom schema parser must run exactly once per model decision"
  );

  const agentOptionResult =
    await run(
      agentOptionParserWorkflow,
      undefined,
      storage
    );

  assert.equal(
    agentOptionResult.result,
    7
  );

  assert.equal(
    agentOptionParserCalls,
    1,
    "AgentOptions.parseAction must run once before built-in validation"
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
