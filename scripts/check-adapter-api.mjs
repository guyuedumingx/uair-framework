import assert from "node:assert/strict";
import {
  readFile
} from "node:fs/promises";
import {
  join
} from "node:path";

const contract =
  JSON.parse(
    await readFile(
      "compat/adapter-api-v067.json",
      "utf8"
    )
  );

const packageDir = {
  "@uair/mcp":
    "mcp",
  "@uair/security":
    "security",
  "@uair/package":
    "package",
  "@uair/sqlite":
    "sqlite",
  "@uair/postgres":
    "postgres",
  "@uair/interaction":
    "interaction",
  "@uair/agent":
    "agent",
  "@uair/otel":
    "otel",
  "@uair/ops":
    "ops"
};

for (
  const [
    packageName,
    names
  ]
  of Object.entries(
    contract
  )
) {
  const dir =
    packageDir[
      packageName
    ];

  assert.ok(
    dir,
    `No adapter directory mapping for ${packageName}`
  );

  const pkg =
    JSON.parse(
      await readFile(
        join(
          "packages",
          dir,
          "package.json"
        ),
        "utf8"
      )
    );

  assert.equal(
    pkg.name,
    packageName
  );

  assert.match(
    pkg.version,
    /^0\.68\.\d+$/,
    `${packageName} must preserve the v0.67 compatibility baseline on the v0.68 release line`
  );

  const module =
    await import(
      `../packages/${dir}/dist/index.js`
    );

  for (
    const name
    of names
  ) {
    assert.equal(
      name in module,
      true,
      `${packageName} public adapter export disappeared: ${name}`
    );
  }
}

console.log(
  JSON.stringify(
    {
      packages:
        Object.keys(
          contract
        ).length,
      policy:
        "public adapter export snapshot",
      result:
        "PASS"
    },
    null,
    2
  )
);

console.log(
  "UAIR adapter API/semver contract verification: PASS"
);
