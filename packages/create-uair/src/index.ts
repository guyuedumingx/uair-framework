#!/usr/bin/env node
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import {
  basename,
  resolve
} from "node:path";

const target =
  process.argv[2] ??
  "my-uair-app";

const dir =
  resolve(
    process.cwd(),
    target
  );

const name =
  basename(
    dir
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9._-]+/g,
      "-"
    )
    .replace(
      /^[-._]+|[-._]+$/g,
      ""
    ) ||
  "my-uair-app";

await mkdir(
  resolve(
    dir,
    "src"
  ),
  {
    recursive: true
  }
);

await writeFile(
  resolve(
    dir,
    "package.json"
  ),
  JSON.stringify(
    {
      name,
      private: true,
      type: "module",
      scripts: {
        dev:
          "tsx src/index.ts"
      },
      dependencies: {
        "@uair/core":
          "^0.67.0"
      },
      devDependencies: {
        "tsx":
          "^4.20.5",
        "typescript":
          "^5.9.2"
      }
    },
    null,
    2
  ) + "\n"
);

await writeFile(
  resolve(
    dir,
    "tsconfig.json"
  ),
  JSON.stringify(
    {
      compilerOptions: {
        target:
          "ES2022",
        module:
          "NodeNext",
        moduleResolution:
          "NodeNext",
        strict:
          true,
        noEmit:
          true,
        skipLibCheck:
          true
      },
      include: [
        "src/**/*.ts"
      ]
    },
    null,
    2
  ) + "\n"
);

await writeFile(
  resolve(
    dir,
    "src/index.ts"
  ),
`import {
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
        \`Hello \${input.name}\`
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
`
);

await writeFile(
  resolve(
    dir,
    "README.md"
  ),
`# ${name}

Generated with create-uair.

\`\`\`bash
npm install
npm run dev
\`\`\`
`
);

console.log(
  `Created ${name}`
);
