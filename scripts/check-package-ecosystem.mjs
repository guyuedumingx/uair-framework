import assert from "node:assert/strict";

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink
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

import {
  PackageLifecycleController
} from "../packages/package/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-package-ecosystem-"
    )
  );

const packageDir =
  join(
    dir,
    "demo-kit"
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

async function linkDependency(
  name,
  target
) {
  const parts =
    name.split("/");

  const destination =
    parts.length ===
      2
      ? join(
          packageDir,
          "node_modules",
          parts[0],
          parts[1]
        )
      : join(
          packageDir,
          "node_modules",
          name
        );

  await mkdir(
    join(
      destination,
      ".."
    ),
    {
      recursive:
        true
    }
  );

  await symlink(
    target,
    destination,
    "dir"
  );
}

try {
  let code =
    await runCli(
      [
        "package",
        "create",
        "@acme/demo-kit",
        "--dir",
        packageDir,
        "--version",
        "1.2.3",
        "--capability",
        "acme.demo.echo"
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

  const created =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    created.packageName,
    "@acme/demo-kit"
  );

  assert.equal(
    created.version,
    "1.2.3"
  );

  const pkg =
    JSON.parse(
      await readFile(
        join(
          packageDir,
          "package.json"
        ),
        "utf8"
      )
    );

  assert.equal(
    pkg.exports["./uair"]
      .import,
    "./dist/uair.js"
  );

  assert.equal(
    pkg.license,
    "MIT"
  );

  await mkdir(
    join(
      packageDir,
      "node_modules"
    ),
    {
      recursive:
        true
    }
  );

  await linkDependency(
    "@uair/core",
    join(
      process.cwd(),
      "packages",
      "core"
    )
  );

  await linkDependency(
    "@uair/package",
    join(
      process.cwd(),
      "packages",
      "package"
    )
  );

  await linkDependency(
    "typescript",
    join(
      process.cwd(),
      "node_modules",
      "typescript"
    )
  );

  code =
    await runCli(
      [
        "package",
        "verify",
        "--dir",
        packageDir
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    0,
    stderr.at(-1)
  );

  const verified =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    verified.result
      .evidence
      .manifest,
    "PASS"
  );

  code =
    await runCli(
      [
        "package",
        "pack",
        "--dir",
        packageDir
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    0,
    stderr.at(-1)
  );

  const packed =
    JSON.parse(
      stdout.pop()
    );

  assert.match(
    packed.result.artifact,
    /\.tgz$/
  );

  code =
    await runCli(
      [
        "package",
        "catalog",
        "--dir",
        packageDir,
        "--output",
        join(
          packageDir,
          "catalog-record.json"
        )
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    0,
    stderr.at(-1)
  );

  const catalog =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    catalog.record
      .packageName,
    "@acme/demo-kit"
  );

  assert.equal(
    catalog.record
      .version,
    "1.2.3"
  );

  assert.equal(
    catalog.record
      .capabilities
      .some(
        capability =>
          capability.id ===
            "acme.demo.echo.tool" &&
          capability.metadata
            .exportName ===
            "example"
      ),
    true
  );

  code =
    await runCli(
      [
        "package",
        "status"
      ],
      {
        cwd:
          packageDir,
        io
      }
    );

  assert.equal(
    code,
    0,
    stderr.at(-1)
  );

  const status =
    JSON.parse(
      stdout.pop()
    );

  assert.equal(
    status.state
      .packageName,
    "@acme/demo-kit"
  );

  assert.equal(
    status.state
      .receipts
      .some(
        receipt =>
          receipt.phase ===
            "verified"
      ),
    true
  );

  code =
    await runCli(
      [
        "package",
        "publish",
        "--dir",
        packageDir
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    1
  );

  assert.match(
    stderr.pop(),
    /explicit approval/
  );

  code =
    await runCli(
      [
        "package",
        "publish",
        "--dir",
        packageDir,
        "--approve"
      ],
      {
        cwd:
          dir,
        io
      }
    );

  assert.equal(
    code,
    1
  );

  assert.match(
    stderr.pop(),
    /Real npm publish is disabled/
  );

  const calls = [];

  const fake =
    {
      async verify(
        input
      ) {
        calls.push([
          "verify",
          input.version
        ]);

        return {
          evidence: {
            verified:
              true
          }
        };
      },

      async pack(
        input
      ) {
        calls.push([
          "pack",
          input.version
        ]);

        return {
          artifact:
            `${input.packageName}-${input.version}.tgz`,
          integrity:
            `sha512-${input.version}`
        };
      },

      async publish(
        input
      ) {
        calls.push([
          "publish",
          input.version
        ]);

        return {
          registry:
            "fixture://registry",
          provenance: {
            verified:
              true
          }
        };
      },

      async install(
        input
      ) {
        calls.push([
          "install",
          input.version
        ]);

        return {
          evidence: {
            installed:
              true
          }
        };
      }
    };

  const lifecycle =
    new PackageLifecycleController({
      stateFile:
        join(
          dir,
          "lifecycle-state.json"
        ),
      adapter:
        fake
    });

  await assert.rejects(
    () =>
      lifecycle.publish({
        packageDir,
        packageName:
          "@acme/business-kit",
        version:
          "1.0.0",
        approved:
          true
      }),
    /must be verified and packed/
  );

  await lifecycle.verify({
    packageDir,
    packageName:
      "@acme/business-kit",
    version:
      "1.0.0"
  });

  await lifecycle.pack({
    packageDir,
    packageName:
      "@acme/business-kit",
    version:
      "1.0.0"
  });

  await assert.rejects(
    () =>
      lifecycle.publish({
        packageDir,
        packageName:
          "@acme/business-kit",
        version:
          "1.0.0",
        approved:
          false
      }),
    /explicit approval/
  );

  await lifecycle.publish({
    packageDir,
    packageName:
      "@acme/business-kit",
    version:
      "1.0.0",
    approved:
      true
  });

  const callsAfterPublish =
    calls.length;

  const republished =
    await lifecycle.publish({
      packageDir,
      packageName:
        "@acme/business-kit",
      version:
        "1.0.0",
      approved:
        true
    });

  assert.equal(
    calls.length,
    callsAfterPublish,
    "same-version publish must be idempotent after a recorded success"
  );

  assert.equal(
    republished.alreadyPublished,
    true
  );

  await assert.rejects(
    () =>
      lifecycle.install({
        packageName:
          "@acme/business-kit",
        version:
          "1.0.0",
        approved:
          false
      }),
    /explicit approval/
  );

  let state =
    await lifecycle.install({
      packageName:
        "@acme/business-kit",
      version:
        "1.0.0",
      approved:
        true
    });

  assert.equal(
    state.currentVersion,
    "1.0.0"
  );

  state =
    await lifecycle.install({
      packageName:
        "@acme/business-kit",
      version:
        "1.1.0",
      approved:
        true
    });

  assert.equal(
    state.currentVersion,
    "1.1.0"
  );

  assert.equal(
    state.previousVersion,
    "1.0.0"
  );

  const callsBeforeIdempotentInstall =
    calls.length;

  await lifecycle.install({
    packageName:
      "@acme/business-kit",
    version:
      "1.1.0",
    approved:
      true
  });

  assert.equal(
    calls.length,
    callsBeforeIdempotentInstall,
    "installing the already-current version should be idempotent"
  );

  state =
    await lifecycle.rollback({
      packageName:
        "@acme/business-kit",
      approved:
        true
    });

  assert.equal(
    state.currentVersion,
    "1.0.0"
  );

  assert.equal(
    state.previousVersion,
    "1.1.0"
  );

  const callsAfterRollback =
    calls.length;

  state =
    await lifecycle.rollback({
      packageName:
        "@acme/business-kit",
      approved:
        true
    });

  assert.equal(
    calls.length,
    callsAfterRollback,
    "repeated rollback must not roll forward to the version that was just removed"
  );

  assert.equal(
    state.currentVersion,
    "1.0.0"
  );

  assert.equal(
    state.receipts
      .some(
        receipt =>
          receipt.phase ===
            "published" &&
          receipt.version ===
            "1.0.0"
      ),
    true
  );

  assert.equal(
    state.receipts
      .some(
        receipt =>
          receipt.phase ===
            "upgraded" &&
          receipt.version ===
            "1.1.0"
      ),
    true
  );

  assert.equal(
    state.receipts
      .some(
        receipt =>
          receipt.phase ===
            "rolled-back" &&
          receipt.version ===
            "1.0.0"
      ),
    true
  );

  console.log(
    JSON.stringify(
      {
        cli: {
          create:
            "PASS",
          verify:
            "PASS",
          pack:
            "PASS",
          catalog:
            "PASS",
          statusInference:
            "PASS",
          publishApproval:
            "PASS",
          realPublishSafeDefault:
            "PASS"
        },
        lifecycle: {
          verifyBeforePublish:
            "PASS",
          packBeforePublish:
            "PASS",
          explicitPublishApproval:
            "PASS",
          install:
            "PASS",
          upgrade:
            "PASS",
          idempotentInstall:
            "PASS",
          idempotentPublish:
            "PASS",
          rollback:
            "PASS",
          idempotentRollback:
            "PASS",
          receipts:
            "PASS"
        },
        packageManager:
          "npm",
        customRegistry:
          false,
        coreChanges:
          0
      },
      null,
      2
    )
  );

  console.log(
    "UAIR package ecosystem lifecycle verification: PASS"
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
