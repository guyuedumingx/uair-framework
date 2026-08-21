import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink
} from "node:fs/promises";
import {
  spawnSync
} from "node:child_process";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-create-"
    )
  );

const app =
  join(
    dir,
    "my-native-uair-app"
  );

function run(
  command,
  args,
  cwd
) {
  const result =
    spawnSync(
      command,
      args,
      {
        cwd,
        encoding:
          "utf8"
      }
    );

  if (
    result.status !== 0
  ) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`
    );
  }

  return result;
}

try {
  const created =
    run(
      process.execPath,
      [
        "packages/create-uair/dist/index.js",
        app
      ],
      process.cwd()
    );

  assert.match(
    created.stdout,
    /Created my-native-uair-app/
  );

  const pkg =
    JSON.parse(
      await readFile(
        join(
          app,
          "package.json"
        ),
        "utf8"
      )
    );

  assert.deepEqual(
    Object.keys(
      pkg.dependencies
    ),
    [
      "@uair/core"
    ],
    "default scaffold should have one runtime dependency"
  );

  const rootPackage =
    JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "package.json"
        ),
        "utf8"
      )
    );

  assert.equal(
    pkg.dependencies[
      "@uair/core"
    ],
    `^${rootPackage.version}`
  );

  await mkdir(
    join(
      app,
      "node_modules",
      "@uair"
    ),
    {
      recursive:
        true
    }
  );

  await symlink(
    join(
      process.cwd(),
      "packages",
      "core"
    ),
    join(
      app,
      "node_modules",
      "@uair",
      "core"
    ),
    "dir"
  );

  run(
    "npx",
    [
      "tsc",
      "-p",
      app,
      "--pretty",
      "false",
      "--noEmit",
      "false",
      "--outDir",
      join(
        app,
        "dist"
      )
    ],
    process.cwd()
  );

  const executed =
    run(
      process.execPath,
      [
        join(
          app,
          "dist",
          "index.js"
        )
      ],
      app
    );

  assert.match(
    executed.stdout,
    /Hello UAIR/
  );

  const source =
    await readFile(
      join(
        app,
        "src",
        "index.ts"
      ),
      "utf8"
    );

  assert.match(
    source,
    /workflow\(\s*"hello"/s
  );

  assert.doesNotMatch(
    source,
    /version\s*:/
  );

  assert.doesNotMatch(
    source,
    /@uair\/security|@uair\/oa|@uair\/ui/
  );

  console.log(
    JSON.stringify(
      {
        generated:
          "PASS",
        dependencyCount:
          1,
        typecheck:
          "PASS",
        execution:
          "PASS",
        explicitIdCount:
          1,
        explicitVersion:
          false,
        enterprisePackages:
          false
      },
      null,
      2
    )
  );

  console.log(
    "UAIR create-uair first-run smoke verification: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive:
        true,
      force:
        true
    }
  );
}
