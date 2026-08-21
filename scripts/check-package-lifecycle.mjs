import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import {
  spawnSync
} from "node:child_process";
import {
  join
} from "node:path";
import {
  pathToFileURL
} from "node:url";
import {
  tmpdir
} from "node:os";

import {
  loadUairPackage
} from "../packages/package/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-package-lifecycle-"
    )
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
          "utf8",
        env: {
          ...process.env,
          npm_config_cache:
            join(
              dir,
              ".npm-cache"
            )
        }
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

async function fixture(
  version,
  generation
) {
  const path =
    join(
      dir,
      `fixture-${generation}`
    );

  await mkdir(
    path,
    {
      recursive: true
    }
  );

  await writeFile(
    join(
      path,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "@fixture/uair-business",
        version,
        type:
          "module",
        exports: {
          ".":
            "./index.js",
          "./uair":
            "./uair.js"
        },
        license:
          "MIT"
      },
      null,
      2
    ) +
      "\n"
  );

  await writeFile(
    join(
      path,
      "index.js"
    ),
    `export const generation = ${JSON.stringify(generation)};\n`
  );

  await writeFile(
    join(
      path,
      "uair.js"
    ),
    `export const uair = ${JSON.stringify({
      name:
        "@fixture/uair-business",
      version,
      metadata: {
        generation
      }
    })};\n`
  );

  const packed =
    JSON.parse(
      run(
        "npm",
        [
          "pack",
          "--json"
        ],
        path
      ).stdout
    )[0];

  return join(
    path,
    packed.filename
  );
}

async function installedVersion(
  app
) {
  return JSON.parse(
    await readFile(
      join(
        app,
        "node_modules",
        "@fixture",
        "uair-business",
        "package.json"
      ),
      "utf8"
    )
  ).version;
}

async function loadedGeneration(
  app
) {
  const file =
    join(
      app,
      "node_modules",
      "@fixture",
      "uair-business",
      "uair.js"
    );

  const loaded =
    await loadUairPackage(
      `${pathToFileURL(file).href}?v=${Date.now()}-${Math.random()}`
    );

  return loaded.manifest
    .metadata
    ?.generation;
}

try {
  const v1 =
    await fixture(
      "1.0.0",
      "v1"
    );

  const v2 =
    await fixture(
      "1.1.0",
      "v2"
    );

  const app =
    join(
      dir,
      "app"
    );

  await mkdir(
    app,
    {
      recursive: true
    }
  );

  await writeFile(
    join(
      app,
      "package.json"
    ),
    JSON.stringify(
      {
        private:
          true,
        type:
          "module"
      },
      null,
      2
    ) +
      "\n"
  );

  const install =
    tarball =>
      run(
        "npm",
        [
          "install",
          "--no-save",
          "--ignore-scripts",
          "--package-lock=false",
          tarball
        ],
        app
      );

  install(v1);

  assert.equal(
    await installedVersion(
      app
    ),
    "1.0.0"
  );

  assert.equal(
    await loadedGeneration(
      app
    ),
    "v1"
  );

  install(v2);

  assert.equal(
    await installedVersion(
      app
    ),
    "1.1.0"
  );

  assert.equal(
    await loadedGeneration(
      app
    ),
    "v2"
  );

  // Roll back using normal npm package semantics.
  install(v1);

  assert.equal(
    await installedVersion(
      app
    ),
    "1.0.0"
  );

  assert.equal(
    await loadedGeneration(
      app
    ),
    "v1"
  );

  console.log(
    JSON.stringify(
      {
        install:
          "1.0.0 PASS",
        upgrade:
          "1.1.0 PASS",
        rollback:
          "1.0.0 PASS",
        packageManager:
          "npm",
        customRegistry:
          false
      },
      null,
      2
    )
  );

  console.log(
    "UAIR npm package install/upgrade/rollback verification: PASS"
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
