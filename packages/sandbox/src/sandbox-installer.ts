import {
  mkdtemp,
  readFile,
  writeFile,
  rm
} from "node:fs/promises";
import {
  tmpdir
} from "node:os";
import {
  join
} from "node:path";
import type {
  PackageInstaller
} from "@uair/package";
import type {
  PackageTrustRecord
} from "@uair/security";

export type SandboxInstallRequest = {
  packageName: string;
  version?: string;
  trust:
    PackageTrustRecord;
};

export type SandboxRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface SandboxRunner {
  run(
    input: {
      cwd: string;
      command: string;
      args: string[];
      env:
        Record<
          string,
          string
        >;
      network:
        PackageTrustRecord[
          "network"
        ];
      filesystem:
        PackageTrustRecord[
          "filesystem"
        ];
    }
  ): Promise<
    SandboxRunResult
  >;
}

/**
 * The installer owns package-manager behavior.
 * The runner owns actual process / OS isolation.
 *
 * This separation is intentional: a production runner may be a
 * container, microVM, Cloudflare Sandbox, Kubernetes job, etc.
 */
export class SandboxedPackageInstaller
  implements PackageInstaller {
  constructor(
    private readonly runner:
      SandboxRunner,
    private readonly trustResolver:
      (
        packageName: string,
        version?: string
      ) => Promise<
        PackageTrustRecord
      >
  ) {}

  async install(
    packageName: string,
    version?: string
  ) {
    const trust =
      await this.trustResolver(
        packageName,
        version
      );

    const dir =
      await mkdtemp(
        join(
          tmpdir(),
          "uair-package-"
        )
      );

    try {
      await writeFile(
        join(
          dir,
          "package.json"
        ),
        JSON.stringify(
          {
            private: true,
            type: "module"
          },
          null,
          2
        ),
        "utf8"
      );

      const spec =
        version
          ? `${packageName}@${version}`
          : packageName;

      const args = [
        "install",
        "--no-save",
        "--package-lock=false",
        "--audit=false",
        "--fund=false"
      ];

      // Lifecycle scripts are the biggest direct install-time escape
      // hatch. Default to disabled.
      if (
        trust.allowLifecycleScripts !==
          true
      ) {
        args.push(
          "--ignore-scripts"
        );
      }

      args.push(spec);

      const env:
        Record<
          string,
          string
        > = {
        PATH:
          process.env.PATH ??
          "",
        HOME: dir,
        npm_config_cache:
          join(
            dir,
            ".npm-cache"
          )
      };

      // Secrets are opt-in by explicit name. No ambient environment is
      // forwarded by default.
      for (
        const name
        of trust.allowedSecrets ??
          []
      ) {
        const value =
          process.env[name];

        if (
          value !== undefined
        ) {
          env[name] = value;
        }
      }

      const result =
        await this.runner.run({
          cwd: dir,
          command: "npm",
          args,
          env,
          network:
            trust.network ??
            "registry-only",
          filesystem:
            trust.filesystem ??
            "isolated"
        });

      if (
        result.exitCode !== 0
      ) {
        throw new Error(
          `sandboxed npm install failed: ${result.stderr || result.stdout}`
        );
      }

      // Native addons cannot be conclusively detected before install in
      // every package shape. The production runner should also enforce
      // this at execution/runtime level. Here we inspect the installed
      // package metadata as an additional check.
      const installedPackageJson =
        join(
          dir,
          "node_modules",
          packageName,
          "package.json"
        );

      let metadata:
        any = {};

      try {
        metadata =
          JSON.parse(
            await readFile(
              installedPackageJson,
              "utf8"
            )
          );
      } catch {
        // Scoped packages and virtualized package managers still resolve
        // through node_modules/packageName in standard npm installs.
      }

      if (
        trust.allowNativeAddons !==
          true &&
        (
          metadata.gypfile === true ||
          metadata.binary ||
          metadata.os ===
            "native"
        )
      ) {
        throw new Error(
          `package "${packageName}" appears to require native addon support`
        );
      }

      return {
        packageName,
        version,
        installDir: dir,
        evidence: {
          lifecycleScripts:
            trust.allowLifecycleScripts ===
            true,
          nativeAddons:
            metadata.gypfile ===
              true ||
            Boolean(
              metadata.binary
            ) ||
            metadata.os ===
              "native",
          network:
            trust.network ??
            "registry-only",
          filesystem:
            trust.filesystem ??
            "isolated",
          secretNames:
            trust.allowedSecrets ??
            []
        }
      };
    } catch (error) {
      await rm(
        dir,
        {
          recursive: true,
          force: true
        }
      );

      throw error;
    }
  }
}
