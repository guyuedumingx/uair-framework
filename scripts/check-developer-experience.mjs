import assert from "node:assert/strict";
import {
  readFile
} from "node:fs/promises";

const rootPackage =
  JSON.parse(
    await readFile(
      "package.json",
      "utf8"
    )
  );

const files = {
  core:
    await readFile(
      "packages/core/src/types.ts",
      "utf8"
    ),

  create:
    await readFile(
      "packages/create-uair/src/index.ts",
      "utf8"
    ),

  playgroundServer:
    await readFile(
      "examples/playground/src/server.ts",
      "utf8"
    ),

  playgroundWorkflow:
    await readFile(
      "examples/playground/src/workflow.ts",
      "utf8"
    ),

  basic:
    await readFile(
      "examples/basic/src/index.ts",
      "utf8"
    )
};

assert.match(
  files.core,
  /readonly id: string/
);

assert.match(
  files.create,
  /workflow\(\s*"hello"/s
);

assert.match(
  files.create,
  new RegExp(
    `"@uair\\/core":\\s*"\\^${rootPackage.version.replaceAll(".", "\\.")}"`
  )
);

assert.doesNotMatch(
  files.create,
  /"@uair\/ui"/
);

assert.match(
  files.create,
  /new JsonFileStorage/
);

assert.match(
  files.create,
  /await run\(/
);

assert.doesNotMatch(
  files.playgroundServer,
  /new RuntimeEngine\([\s\S]*?\{\s*"playground\.demo"/
);

assert.match(
  files.playgroundServer,
  /new RuntimeEngine\([\s\S]*?\[\s*playgroundWorkflow\s*\]/s
);

assert.doesNotMatch(
  files.playgroundWorkflow,
  /asAgentTool\(\s*"[^"]+"/
);

assert.match(
  files.basic,
  /workflow\(\s*"hello"/s
);

console.log(
  "UAIR developer-experience identity check: PASS"
);
