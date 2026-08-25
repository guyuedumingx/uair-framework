import {
  readFile,
  readdir,
  access
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  spawn,
  spawnSync
} from "node:child_process";
import {
  tmpdir
} from "node:os";
import {
  mkdtempSync
} from "node:fs";

const root =
  process.cwd();

const fail =
  message => {
    console.error(
      `RELEASE PREFLIGHT FAIL: ${message}`
    );
    process.exit(1);
  };

await access(
  join(root, "LICENSE")
);

const license =
  await readFile(
    join(root, "LICENSE"),
    "utf8"
  );

if (
  !license.startsWith(
    "MIT License"
  )
) {
  fail(
    "root LICENSE is not MIT"
  );
}

const packageDirs =
  await readdir(
    join(root, "packages"),
    {
      withFileTypes: true
    }
  );

for (
  const dir of packageDirs
) {
  if (!dir.isDirectory()) {
    continue;
  }

  const path =
    join(
      root,
      "packages",
      dir.name,
      "package.json"
    );

  try {
    const pkg =
      JSON.parse(
        await readFile(
          path,
          "utf8"
        )
      );

    if (
      pkg.license !== "MIT"
    ) {
      fail(
        `${pkg.name} missing MIT license metadata`
      );
    }
  } catch (
    error
  ) {
    if (
      error?.code ===
        "ENOENT"
    ) {
      continue;
    }

    throw error;
  }
}

const run =
  (
    command,
    args,
    env = process.env
  ) => {
    console.log(
      `\n$ ${command} ${args.join(" ")}`
    );

    const result =
      spawnSync(
        command,
        args,
        {
          cwd: root,
          stdio:
            "inherit",
          env
        }
      );

    if (
      result.status !== 0
    ) {
      process.exit(
        result.status ?? 1
      );
    }
  };

run(
  "npm",
  [
    "run",
    "check:api"
  ]
);

run(
  "npm",
  [
    "run",
    "check:package-boundaries"
  ]
);

run(
  "npm",
  [
    "run",
    "check:durable-semantics"
  ]
);

run(
  "npm",
  [
    "run",
    "check:dx"
  ]
);

run(
  "npm",
  [
    "run",
    "check:agent-validation"
  ]
);

run(
  "npm",
  [
    "run",
    "check:surface"
  ]
);

run(
  "npm",
  [
    "run",
    "check:agent-boundary"
  ]
);

run(
  "npm",
  [
    "run",
    "chaos"
  ]
);

run(
  "npm",
  [
    "run",
    "test:process-crash"
  ]
);

const cache =
  mkdtempSync(
    join(
      tmpdir(),
      "uair-npm-cache-"
    )
  );

const env = {
  ...process.env,
  npm_config_cache:
    cache
};

const packTargets = [];

for (
  const dir
  of packageDirs
) {
  if (!dir.isDirectory()) {
    continue;
  }

  const path =
    join(
      root,
      "packages",
      dir.name,
      "package.json"
    );

  try {
    const pkg =
      JSON.parse(
        await readFile(
          path,
          "utf8"
        )
      );

    packTargets.push({
      dir:
        dir.name,
      name:
        pkg.name
    });
  } catch (
    error
  ) {
    if (
      error?.code ===
        "ENOENT"
    ) {
      continue;
    }

    throw error;
  }
}

const packOne =
  target =>
    new Promise(
      (
        resolve,
        reject
      ) => {
        console.log(
          `\n$ npm pack --dry-run (${target.name})`
        );

        const child =
          spawn(
            "npm",
            [
              "pack",
              "--dry-run",
              "--json"
            ],
            {
              cwd:
                join(
                  root,
                  "packages",
                  target.dir
                ),
              stdio:
                "inherit",
              env
            }
          );

        child.on(
          "error",
          reject
        );

        child.on(
          "close",
          code => {
            if (
              code === 0
            ) {
              resolve();
              return;
            }

            reject(
              new Error(
                `npm pack --dry-run failed for ${target.name} with code ${code}`
              )
            );
          }
        );
      }
    );

for (
  let index = 0;
  index <
    packTargets.length;
  index += 4
) {
  await Promise.all(
    packTargets
      .slice(
        index,
        index + 4
      )
      .map(
        packOne
      )
  );
}

run(
  "npm",
  [
    "run",
    "check:agent-compatibility"
  ]
);

run(
  "npm",
  [
    "run",
    "check:suspension-race"
  ]
);

run(
  "npm",
  [
    "run",
    "check:storage-schema"
  ]
);

run(
  "npm",
  [
    "run",
    "check:sqlite-adversarial"
  ]
);

run(
  "npm",
  [
    "run",
    "check:sqlite-crash-points"
  ]
);

run(
  "npm",
  [
    "run",
    "check:queue-faults"
  ]
);

run(
  "npm",
  [
    "run",
    "check:postgres-gate"
  ]
);

run(
  "npm",
  [
    "run",
    "check:security-hardening"
  ]
);

run(
  "npm",
  [
    "run",
    "check:upgrade-compatibility"
  ]
);

run(
  "npm",
  [
    "run",
    "check:adapter-api"
  ]
);

run(
  "npm",
  [
    "run",
    "check:package-lifecycle"
  ]
);

run(
  "npm",
  [
    "run",
    "check:operability"
  ]
);

run(
  "npm",
  [
    "run",
    "check:identity-dx"
  ]
);

run(
  "npm",
  [
    "run",
    "check:create-uair"
  ]
);

run(
  "npm",
  [
    "run",
    "check:docs-acceptance"
  ]
);

console.log(
  "\nUAIR release preflight: PASS"
);


run(
  "npm",
  [
    "run",
    "check:api-dx-audit"
  ]
);

run(
  "npm",
  [
    "run",
    "check:release-candidate-source"
  ]
);
