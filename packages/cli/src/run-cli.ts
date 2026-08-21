import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  join,
  resolve
} from "node:path";

import {
  pathToFileURL
} from "node:url";

import {
  run
} from "@uair/core";

import {
  JsonFileStorage
} from "@uair/core/runtime";

import {
  CapabilityResolver,
  catalogRecordFromManifest,
  loadUairPackage,
  NodeNpmPackageLifecycleAdapter,
  PackageLifecycleController,
  scaffoldUairPackage,
  StaticPackageCatalog
} from "@uair/package";

import type {
  BuilderResult
} from "@uair/builder";

import {
  analyzeProjectGovernance,
  analyzeProjectImpact,
  buildProjectGraph,
  createBuilderWorkflow,
  createCodexBuilderDefaults,
  createProjectAwareBuilderDefaults,
  ExtensionController,
  LocalReceiptDeploymentAdapter,
  LocalReceiptExtensionAdapter,
  materializeArtifacts,
  ReleaseController,
  renderProjectGraphMermaid
} from "@uair/builder";

type CliIo = {
  stdout(
    value: string
  ): void;
  stderr(
    value: string
  ): void;
};

type CliOptions = {
  cwd?: string;
  io?: CliIo;
};

function option(
  args:
    string[],
  name:
    string
) {
  const index =
    args.indexOf(
      name
    );

  if (
    index === -1
  ) {
    return undefined;
  }

  return args[
    index + 1
  ];
}

function flag(
  args:
    string[],
  name:
    string
) {
  return args.includes(
    name
  );
}

function commandHelp() {
  return `UAIR CLI

Usage:
  uair build --requirement "..." [--backend codex|deterministic] [--runtime <dir>]
  uair review [--runtime <dir>]
  uair release --approve [--runtime <dir>]
  uair status [--runtime <dir>]
  uair retire --approve [--runtime <dir>]
  uair lint
  uair impact <node-key-or-id>
  uair graph [--output <file>]
  uair extensions
  uair extend --approve

  uair package create <name> [--dir <dir>] [--version <semver>] [--capability <id>]
  uair package verify [--dir <dir>]
  uair package pack [--dir <dir>]
  uair package catalog [--dir <dir>] [--output <file>]
  uair package status [--name <package>]
  uair package install <name> <version> --approve
  uair package upgrade <name> <version> --approve
  uair package rollback <name> --approve
  uair package publish [--dir <dir>] --approve --npm-publish

Notes:
  build defaults to the Codex backend.
  use --backend deterministic for the reproducible reference backend.
  Codex options: --codex-bin <path> --model <model>.
  capability discovery catalog: --catalog <json-file>.
  release/retire/extend require explicit --approve.
  package install/upgrade/rollback/publish require explicit --approve.
  real npm publish additionally requires --npm-publish.
  the default deployment/extension adapters write local receipts only.
`;
}

function summarizeProposal(
  proposal:
    any
) {
  return {
    package:
      `${proposal.packageName}@${proposal.version}`,
    workflow:
      proposal
        .deploymentPlan
        ?.target
        ?.workflowId,
    targetVersion:
      proposal
        .deploymentPlan
        ?.target
        ?.workflowVersion,
    changeSafe:
      proposal
        .changeSafety
        ?.safe ??
      true,
    contractCompatible:
      proposal
        .contractCompatibility
        ?.compatible ??
      true,
    migration:
      proposal
        .migrationPlan
        ?.selected ??
      "none",
    deploymentReady:
      proposal
        .deploymentPlan
        ?.releaseAllowed ??
      false,
    runtimeRisk:
      proposal
        .impact
        ?.activeExecutionRisk,
    retireReady:
      proposal
        .deploymentPlan
        ?.retireGate
        ?.ready
  };
}


function lifecycleStatePath(
  cwd: string,
  packageName: string
) {
  const safe =
    packageName
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "_"
      );

  return join(
    cwd,
    ".uair",
    "package-lifecycle",
    `${safe}.json`
  );
}

async function packageMetadata(
  packageDir: string
) {
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

  if (
    typeof pkg.name !==
      "string" ||
    typeof pkg.version !==
      "string"
  ) {
    throw new Error(
      "package.json must contain name and version"
    );
  }

  return {
    name:
      pkg.name as string,
    version:
      pkg.version as string
  };
}

export async function runCli(
  argv:
    string[],
  options:
    CliOptions = {}
) {
  const cwd =
    resolve(
      options.cwd ??
      process.cwd()
    );

  const io =
    options.io ?? {
      stdout:
        (
          value: string
        ) =>
          console.log(
            value
          ),
      stderr:
        (
          value: string
        ) =>
          console.error(
            value
          )
    };

  const command =
    argv[0];

  if (
    !command ||
    command ===
      "help" ||
    flag(
      argv,
      "--help"
    ) ||
    flag(
      argv,
      "-h"
    )
  ) {
    io.stdout(
      commandHelp()
    );

    return 0;
  }

  const uairDir =
    resolve(
      cwd,
      ".uair"
    );

  const runtimeDir =
    resolve(
      cwd,
      option(
        argv,
        "--runtime"
      ) ??
      ".uair/runtime"
    );

  const buildDir =
    join(
      uairDir,
      "build"
    );

  const proposalFile =
    join(
      buildDir,
      "release-proposal.json"
    );

  const candidateDir =
    join(
      buildDir,
      "candidate"
    );

  const releaseDir =
    join(
      uairDir,
      "release"
    );

  const storage =
    new JsonFileStorage(
      runtimeDir
    );

  const extensionController =
    new ExtensionController({
      stateDir:
        join(
          releaseDir,
          "extensions"
        ),
      adapter:
        new LocalReceiptExtensionAdapter()
    });

  const controller =
    new ReleaseController({
      stateDir:
        releaseDir,
      storage,
      adapter:
        new LocalReceiptDeploymentAdapter(
          join(
            releaseDir,
            "receipts"
          )
        ),
      extensions:
        extensionController
    });

  try {
    if (
      command ===
        "package"
    ) {
      const subcommand =
        argv[1];

      if (
        !subcommand
      ) {
        throw new Error(
          "package requires a subcommand: create, verify, pack, catalog, status, install, upgrade, rollback, or publish. Run `uair help` for usage."
        );
      }

      if (
        subcommand ===
          "create"
      ) {
        const packageName =
          argv[2];

        if (!packageName) {
          throw new Error(
            "package create requires <name>"
          );
        }

        const target =
          resolve(
            cwd,
            option(
              argv,
              "--dir"
            ) ??
            packageName
              .replace(
                /^@[^/]+\//,
                ""
              )
          );

        const created =
          await scaffoldUairPackage({
            dir:
              target,
            packageName,
            version:
              option(
                argv,
                "--version"
              ),
            capabilityId:
              option(
                argv,
                "--capability"
              )
          });

        const lifecycle =
          new PackageLifecycleController({
            stateFile:
              lifecycleStatePath(
                target,
                packageName
              ),
            adapter:
              new NodeNpmPackageLifecycleAdapter({
                installCwd:
                  cwd
              })
          });

        await lifecycle.create({
          packageName:
            created.packageName,
          version:
            created.version,
          evidence: {
            scaffold:
              "uair package create"
          }
        });

        io.stdout(
          JSON.stringify(
            {
              command:
                "package create",
              ...created
            },
            null,
            2
          )
        );

        return 0;
      }

      if (
        [
          "verify",
          "pack",
          "catalog",
          "publish"
        ].includes(
          subcommand
        )
      ) {
        const packageDir =
          resolve(
            cwd,
            option(
              argv,
              "--dir"
            ) ??
            "."
          );

        const metadata =
          await packageMetadata(
            packageDir
          );

        const lifecycle =
          new PackageLifecycleController({
            stateFile:
              lifecycleStatePath(
                packageDir,
                metadata.name
              ),
            adapter:
              new NodeNpmPackageLifecycleAdapter({
                installCwd:
                  cwd,
                publishRegistry:
                  option(
                    argv,
                    "--registry"
                  ),
                publishTag:
                  option(
                    argv,
                    "--tag"
                  ),
                allowPublish:
                  flag(
                    argv,
                    "--npm-publish"
                  )
              })
          });

        if (
          subcommand ===
            "verify"
        ) {
          const result =
            await lifecycle.verify({
              packageDir,
              packageName:
                metadata.name,
              version:
                metadata.version
            });

          io.stdout(
            JSON.stringify(
              {
                command:
                  "package verify",
                package:
                  metadata,
                result
              },
              null,
              2
            )
          );

          return 0;
        }

        if (
          subcommand ===
            "pack"
        ) {
          const result =
            await lifecycle.pack({
              packageDir,
              packageName:
                metadata.name,
              version:
                metadata.version
            });

          io.stdout(
            JSON.stringify(
              {
                command:
                  "package pack",
                package:
                  metadata,
                result
              },
              null,
              2
            )
          );

          return 0;
        }

        if (
          subcommand ===
            "catalog"
        ) {
          const manifestFile =
            resolve(
              packageDir,
              "dist",
              "uair.js"
            );

          const loaded =
            await loadUairPackage(
              `${pathToFileURL(manifestFile).href}?catalog=${Date.now()}`
            );

          const record =
            catalogRecordFromManifest(
              loaded.manifest
            );

          const output =
            option(
              argv,
              "--output"
            );

          if (output) {
            const target =
              resolve(
                cwd,
                output
              );

            await mkdir(
              dirname(
                target
              ),
              {
                recursive:
                  true
              }
            );

            await writeFile(
              target,
              JSON.stringify(
                record,
                null,
                2
              ) +
              "\n",
              "utf8"
            );
          }

          io.stdout(
            JSON.stringify(
              {
                command:
                  "package catalog",
                record,
                output:
                  output
                    ? resolve(
                        cwd,
                        output
                      )
                    : undefined
              },
              null,
              2
            )
          );

          return 0;
        }

        const state =
          await lifecycle.loadState(
            metadata.name
          );

        const packed =
          [...state.receipts]
            .reverse()
            .find(
              receipt =>
                receipt.phase ===
                  "packed" &&
                receipt.version ===
                  metadata.version
            );

        const artifact =
          typeof packed
            ?.evidence
            ?.artifact ===
            "string"
            ? packed.evidence
                .artifact
            : undefined;

        const result =
          await lifecycle.publish({
            packageDir,
            packageName:
              metadata.name,
            version:
              metadata.version,
            artifact,
            approved:
              flag(
                argv,
                "--approve"
              )
          });

        io.stdout(
          JSON.stringify(
            {
              command:
                "package publish",
              package:
                metadata,
              result
            },
            null,
            2
          )
        );

        return 0;
      }

      if (
        subcommand ===
          "status"
      ) {
        const packageName =
          option(
            argv,
            "--name"
          ) ??
          (
            await packageMetadata(
              cwd
            )
          ).name;

        const lifecycle =
          new PackageLifecycleController({
            stateFile:
              lifecycleStatePath(
                cwd,
                packageName
              ),
            adapter:
              new NodeNpmPackageLifecycleAdapter({
                installCwd:
                  cwd
              })
          });

        io.stdout(
          JSON.stringify(
            {
              command:
                "package status",
              state:
                await lifecycle
                  .loadState(
                    packageName
                  )
            },
            null,
            2
          )
        );

        return 0;
      }

      if (
        [
          "install",
          "upgrade"
        ].includes(
          subcommand
        )
      ) {
        const packageName =
          argv[2];

        const version =
          argv[3];

        if (
          !packageName ||
          !version
        ) {
          throw new Error(
            `package ${subcommand} requires <name> <version>`
          );
        }

        const lifecycle =
          new PackageLifecycleController({
            stateFile:
              lifecycleStatePath(
                cwd,
                packageName
              ),
            adapter:
              new NodeNpmPackageLifecycleAdapter({
                installCwd:
                  cwd
              })
          });

        if (
          subcommand ===
            "upgrade"
        ) {
          const current =
            await lifecycle
              .loadState(
                packageName
              );

          if (
            !current.currentVersion
          ) {
            throw new Error(
              `package upgrade requires an installed current version for ${packageName}; use package install first`
            );
          }
        }

        const state =
          await lifecycle.install({
            packageName,
            version,
            approved:
              flag(
                argv,
                "--approve"
              )
          });

        io.stdout(
          JSON.stringify(
            {
              command:
                `package ${subcommand}`,
              state
            },
            null,
            2
          )
        );

        return 0;
      }

      if (
        subcommand ===
          "rollback"
      ) {
        const packageName =
          argv[2];

        if (!packageName) {
          throw new Error(
            "package rollback requires <name>"
          );
        }

        const lifecycle =
          new PackageLifecycleController({
            stateFile:
              lifecycleStatePath(
                cwd,
                packageName
              ),
            adapter:
              new NodeNpmPackageLifecycleAdapter({
                installCwd:
                  cwd
              })
          });

        const state =
          await lifecycle.rollback({
            packageName,
            approved:
              flag(
                argv,
                "--approve"
              )
          });

        io.stdout(
          JSON.stringify(
            {
              command:
                "package rollback",
              state
            },
            null,
            2
          )
        );

        return 0;
      }

      throw new Error(
        `Unknown package subcommand: ${subcommand}`
      );
    }

    if (
      command ===
        "lint"
    ) {
      const graph =
        await buildProjectGraph(
          cwd
        );

      const report =
        await analyzeProjectGovernance(
          graph
        );

      io.stdout(
        JSON.stringify(
          {
            command:
              "lint",
            ...report
          },
          null,
          2
        )
      );

      return report.healthy
        ? 0
        : 1;
    }

    if (
      command ===
        "impact"
    ) {
      const requested =
        argv[1];

      if (!requested) {
        throw new Error(
          "impact requires <node-key-or-id>"
        );
      }

      const graph =
        await buildProjectGraph(
          cwd
        );

      const matches =
        graph.nodes.filter(
          node =>
            node.key ===
              requested ||
            node.id ===
              requested
        );

      if (
        matches.length ===
          0
      ) {
        throw new Error(
          `No ProjectGraph node matches "${requested}".`
        );
      }

      if (
        matches.length >
          1
      ) {
        throw new Error(
          `Ambiguous node id "${requested}". Use one of: ${matches.map(node => node.key).join(", ")}`
        );
      }

      const impact =
        analyzeProjectImpact(
          graph,
          matches[0].key
        );

      io.stdout(
        JSON.stringify(
          {
            command:
              "impact",
            source: {
              key:
                impact.source.key,
              kind:
                impact.source.kind,
              id:
                impact.source.id
            },
            directlyAffected:
              impact
                .directlyAffected
                .map(
                  node => ({
                    key:
                      node.key,
                    kind:
                      node.kind,
                    id:
                      node.id
                  })
                ),
            transitivelyAffected:
              impact
                .transitivelyAffected
                .map(
                  node => ({
                    key:
                      node.key,
                    kind:
                      node.kind,
                    id:
                      node.id
                  })
                ),
            paths:
              impact.paths.map(
                item => ({
                  target:
                    item.target.id,
                  path:
                    item.path.map(
                      node =>
                        node.id
                    ),
                  edgeKinds:
                    item.edgeKinds
                })
              )
          },
          null,
          2
        )
      );

      return 0;
    }

    if (
      command ===
        "graph"
    ) {
      const graph =
        await buildProjectGraph(
          cwd
        );

      const mermaid =
        renderProjectGraphMermaid(
          graph
        );

      const output =
        option(
          argv,
          "--output"
        );

      if (output) {
        const target =
          resolve(
            cwd,
            output
          );

        await mkdir(
          dirname(
            target
          ),
          {
            recursive:
              true
          }
        );

        await writeFile(
          target,
          mermaid +
          "\n",
          "utf8"
        );

        io.stdout(
          JSON.stringify(
            {
              command:
                "graph",
              output:
                target,
              nodes:
                graph.nodes.length,
              edges:
                graph.edges.length
            },
            null,
            2
          )
        );

        return 0;
      }

      io.stdout(
        mermaid
      );

      return 0;
    }

    if (
      command ===
        "build"
    ) {
      const requirement =
        option(
          argv,
          "--requirement"
        );

      if (!requirement) {
        throw new Error(
          "build requires --requirement \"...\""
        );
      }

      const companyScope =
        option(
          argv,
          "--scope"
        ) ??
        "company";

      const packageName =
        option(
          argv,
          "--package"
        );

      const backend =
        option(
          argv,
          "--backend"
        ) ??
        "codex";

      const catalogFile =
        option(
          argv,
          "--catalog"
        );

      const capabilityResolver =
        catalogFile
          ? new CapabilityResolver(
              [],
              new StaticPackageCatalog(
                JSON.parse(
                  await readFile(
                    resolve(
                      cwd,
                      catalogFile
                    ),
                    "utf8"
                  )
                )
              )
            )
          : undefined;

      const deps =
        backend ===
          "deterministic"
          ? createProjectAwareBuilderDefaults(
              cwd,
              storage,
              {
                capabilityResolver
              }
            )
          : backend ===
              "codex"
            ? createCodexBuilderDefaults(
                cwd,
                storage,
                {
                  binary:
                    option(
                      argv,
                      "--codex-bin"
                    ),
                  model:
                    option(
                      argv,
                      "--model"
                    ),
                  capabilityResolver
                }
              )
            : (() => {
                throw new Error(
                  `Unknown Builder backend: ${backend}`
                );
              })();

      const builder =
        createBuilderWorkflow(
          deps
        );

      const execution =
        await run(
          builder,
          {
            description:
              requirement,
            companyScope,
            packageName
          },
          storage
        );

      if (
        execution.status !==
          "completed"
      ) {
        throw new Error(
          `Builder did not complete: ${execution.status}`
        );
      }

      const result =
        execution.result as
          BuilderResult;

      await mkdir(
        buildDir,
        {
          recursive: true
        }
      );

      await materializeArtifacts(
        candidateDir,
        [
          ...result
            .proposal
            .artifacts,
          ...(
            result
              .proposal
              .migrationPlan
              ?.artifacts ??
            []
          ),
          ...(
            result
              .proposal
              .deploymentPlan
              ? [
                  result
                    .proposal
                    .deploymentPlan
                    .artifact
                ]
              : []
          )
        ]
      );

      await writeFile(
        proposalFile,
        JSON.stringify(
          result.proposal,
          null,
          2
        ) +
        "\n",
        "utf8"
      );

      await controller
        .saveProposal(
          result.proposal,
          proposalFile
        );

      await extensionController
        .saveProposal(
          result.proposal
        );

      io.stdout(
        JSON.stringify(
          {
            command:
              "build",
            executionId:
              execution.id,
            backend,
            proposalFile,
            candidateDir,
            proposal:
              summarizeProposal(
                result.proposal
              )
          },
          null,
          2
        )
      );

      return 0;
    }

    if (
      command ===
        "review"
    ) {
      const review =
        await controller
          .review();

      io.stdout(
        JSON.stringify(
          {
            command:
              "review",
            ...review
          },
          null,
          2
        )
      );

      return 0;
    }

    if (
      command ===
        "extensions"
    ) {
      const review =
        await extensionController
          .review();

      io.stdout(
        JSON.stringify(
          {
            command:
              "extensions",
            ...review
          },
          null,
          2
        )
      );

      return 0;
    }

    if (
      command ===
        "extend"
    ) {
      const applied =
        await extensionController
          .apply(
            flag(
              argv,
              "--approve"
            )
          );

      io.stdout(
        JSON.stringify(
          {
            command:
              "extend",
            applied
          },
          null,
          2
        )
      );

      return 0;
    }

    if (
      command ===
        "release"
    ) {
      const released =
        await controller
          .release(
            flag(
              argv,
              "--approve"
            )
          );

      io.stdout(
        JSON.stringify(
          {
            command:
              "release",
            released
          },
          null,
          2
        )
      );

      return 0;
    }

    if (
      command ===
        "status"
    ) {
      const status =
        await controller
          .status();

      io.stdout(
        JSON.stringify(
          {
            command:
              "status",
            phase:
              status.phase,
            released:
              status.released,
            releaseReady:
              status.releaseReady,
            retireReady:
              status.retireReady,
            target:
              status.proposal
                .deploymentPlan
                ?.target,
            previous:
              status.proposal
                .deploymentPlan
                ?.previous,
            runtime:
              status.runtimeImpact
                ?.workflow
          },
          null,
          2
        )
      );

      return 0;
    }

    if (
      command ===
        "retire"
    ) {
      const retired =
        await controller
          .retire(
            flag(
              argv,
              "--approve"
            )
          );

      io.stdout(
        JSON.stringify(
          {
            command:
              "retire",
            retired
          },
          null,
          2
        )
      );

      return 0;
    }

    throw new Error(
      `Unknown command: ${command}. Run \`uair help\` for available commands.`
    );
  } catch (
    error: any
  ) {
    io.stderr(
      error?.message ??
      String(error)
    );

    return 1;
  }
}
