import {
  readFile
} from "node:fs/promises";

import {
  spawnSync
} from "node:child_process";

import {
  resolve
} from "node:path";

import {
  pathToFileURL
} from "node:url";

import {
  loadUairPackage
} from "./package-contract.js";

import type {
  PackageLifecycleAdapter
} from "./lifecycle.js";

function run(
  command: string,
  args: string[],
  cwd: string
) {
  const result =
    spawnSync(
      command,
      args,
      {
        cwd,
        encoding:
          "utf8",
        env:
          process.env
      }
    );

  if (
    result.status !==
      0
  ) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`
    );
  }

  return result;
}

export class NodeNpmPackageLifecycleAdapter
  implements PackageLifecycleAdapter {
  constructor(
    private readonly options: {
      publishRegistry?: string;
      publishTag?: string;
      allowPublish?: boolean;
      installCwd?: string;
    } = {}
  ) {}

  async verify(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
    }
  ) {
    const pkg =
      JSON.parse(
        await readFile(
          resolve(
            input.packageDir,
            "package.json"
          ),
          "utf8"
        )
      );

    if (
      pkg.name !==
        input.packageName
    ) {
      throw new Error(
        `package.json name ${pkg.name} does not match ${input.packageName}`
      );
    }

    if (
      pkg.version !==
        input.version
    ) {
      throw new Error(
        `package.json version ${pkg.version} does not match ${input.version}`
      );
    }

    run(
      "npm",
      [
        "run",
        "build",
        "--if-present"
      ],
      input.packageDir
    );

    run(
      "npm",
      [
        "test",
        "--if-present"
      ],
      input.packageDir
    );

    const dryRun =
      JSON.parse(
        run(
          "npm",
          [
            "pack",
            "--dry-run",
            "--json"
          ],
          input.packageDir
        ).stdout
      )[0];

    const uairPath =
      resolve(
        input.packageDir,
        "dist",
        "uair.js"
      );

    const loaded =
      await loadUairPackage(
        `${pathToFileURL(uairPath).href}?verify=${Date.now()}`
      );

    if (
      loaded.manifest.name !==
        input.packageName
    ) {
      throw new Error(
        `UAIR manifest name ${loaded.manifest.name} does not match package ${input.packageName}`
      );
    }

    if (
      loaded.manifest.version !==
        undefined &&
      loaded.manifest.version !==
        input.version
    ) {
      throw new Error(
        `UAIR manifest version ${loaded.manifest.version} does not match package ${input.version}`
      );
    }

    return {
      evidence: {
        npmPackDryRun:
          true,
        files:
          dryRun.files?.length ??
          0,
        unpackedSize:
          dryRun.unpackedSize,
        manifest:
          "PASS"
      }
    };
  }

  async pack(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
    }
  ) {
    const packed =
      JSON.parse(
        run(
          "npm",
          [
            "pack",
            "--json"
          ],
          input.packageDir
        ).stdout
      )[0];

    return {
      artifact:
        resolve(
          input.packageDir,
          packed.filename
        ),
      integrity:
        packed.integrity ??
        packed.shasum,
      evidence: {
        filename:
          packed.filename,
        size:
          packed.size,
        unpackedSize:
          packed.unpackedSize
      }
    };
  }

  async publish(
    input: {
      packageDir: string;
      packageName: string;
      version: string;
      artifact?: string;
    }
  ) {
    if (
      this.options.allowPublish !==
        true
    ) {
      throw new Error(
        "Real npm publish is disabled. Construct NodeNpmPackageLifecycleAdapter with allowPublish:true only in an authorized release environment."
      );
    }

    const args = [
      "publish",
      input.artifact ??
      input.packageDir
    ];

    if (
      this.options
        .publishRegistry
    ) {
      args.push(
        "--registry",
        this.options
          .publishRegistry
      );
    }

    if (
      this.options
        .publishTag
    ) {
      args.push(
        "--tag",
        this.options
          .publishTag
      );
    }

    run(
      "npm",
      args,
      input.packageDir
    );

    return {
      registry:
        this.options
          .publishRegistry ??
        "npm-configured",
      evidence: {
        packageName:
          input.packageName,
        version:
          input.version
      }
    };
  }

  async install(
    input: {
      packageName: string;
      version: string;
    }
  ) {
    const cwd =
      this.options
        .installCwd ??
      process.cwd();

    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        `${input.packageName}@${input.version}`
      ],
      cwd
    );

    return {
      evidence: {
        packageName:
          input.packageName,
        version:
          input.version,
        cwd
      }
    };
  }
}
