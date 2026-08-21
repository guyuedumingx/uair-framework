import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

import {
  runCli
} from "../packages/cli/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-governance-cli-"
    )
  );

try {
  await mkdir(
    join(
      dir,
      "src"
    ),
    {
      recursive:
        true
    }
  );

  await writeFile(
    join(
      dir,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "@acme/commerce",
        version:
          "1.0.0",
        type:
          "module",
        dependencies: {}
      },
      null,
      2
    )
  );

  await writeFile(
    join(
      dir,
      "src",
      "app.ts"
    ),
    `
import {
  workflow,
  component
} from "@uair/core";

export const charge =
  component(
    "payment.charge",
    async input =>
      input
  );

export const checkout =
  workflow(
    "commerce.checkout",
    async input =>
      charge(input)
  );
`
  );

  const stdout = [];
  const stderr = [];

  const io = {
    stdout(
      value
    ) {
      stdout.push(
        value
      );
    },

    stderr(
      value
    ) {
      stderr.push(
        value
      );
    }
  };

  let code =
    await runCli(
      [
        "lint"
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const lint =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    lint.command,
    "lint"
  );

  assert.equal(
    lint.healthy,
    true
  );

  code =
    await runCli(
      [
        "impact",
        "payment.charge"
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const impact =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    impact.source.id,
    "payment.charge"
  );

  assert.equal(
    impact
      .transitivelyAffected
      .some(
        node =>
          node.id ===
            "commerce.checkout"
      ),
    true
  );

  code =
    await runCli(
      [
        "graph",
        "--output",
        "architecture.mmd"
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    0
  );

  const graphOutput =
    JSON.parse(
      stdout.pop()
    );

  assert.match(
    graphOutput.output,
    /architecture\.mmd$/
  );

  const mermaid =
    await readFile(
      join(
        dir,
        "architecture.mmd"
      ),
      "utf8"
    );

  assert.match(
    mermaid,
    /flowchart LR/
  );

  assert.match(
    mermaid,
    /commerce\.checkout@1/
  );

  assert.deepEqual(
    stderr,
    []
  );

  console.log(
    JSON.stringify(
      {
        lint:
          "PASS",
        impact:
          "PASS",
        graph:
          "PASS"
      },
      null,
      2
    )
  );

  console.log(
    "UAIR architecture governance CLI verification: PASS"
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
