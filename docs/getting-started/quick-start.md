# Quick Start

Install:

```bash
npm create uair@latest my-app
cd my-app
npm install
npm run dev
```

The default project uses only `@uair/core`.

```ts
import {
  run,
  workflow
} from "@uair/core";

import {
  JsonFileStorage
} from "@uair/core/runtime";

const hello =
  workflow(
    "hello",
    async (
      input: {
        name: string;
      }
    ) => ({
      message:
        `Hello ${input.name}`
    })
  );

const execution =
  await run(
    hello,
    {
      name:
        "UAIR"
    },
    new JsonFileStorage(
      ".uair/executions"
    )
  );

console.log(
  execution.result
);
```

Mental model:

```text
ordinary TypeScript
→ ordinary functions

durable external operation
→ component()

long-running durable process
→ workflow()

human/external response
→ interaction/suspension

production host
→ choose storage + optional security/ops/adapters
```

Read next:

- `core-concepts.md`
- `mental-model.md`
- `../guides/business-workflow.md`
- `../guides/interactive-agent.md`
