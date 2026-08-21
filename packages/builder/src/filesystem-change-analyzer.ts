import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm
} from "node:fs/promises";

import {
  dirname,
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

import type {
  Storage
} from "@uair/core/runtime";

import type {
  ChangeAnalyzer
} from "./interfaces.js";

import type {
  BusinessSpec,
  GeneratedArtifact
} from "./types.js";

import {
  buildProjectGraph
} from "./project-graph.js";

import {
  analyzeProjectGovernance
} from "./project-governance.js";

import {
  createChangeSet,
  analyzeChangeSetSafety
} from "./change-set.js";

import {
  analyzeContractCompatibility,
  type RuntimeSurfaceSample
} from "./contract-compatibility.js";

import {
  materializeArtifacts
} from "./writer.js";

function packageFallbackDir(
  packageName: string
) {
  const name =
    packageName
      .replace(
        /^@/,
        ""
      )
      .replace(
        /\//g,
        "-"
      );

  return join(
    "packages",
    name
  );
}

export class FilesystemChangeAnalyzer
  implements ChangeAnalyzer {
  constructor(
    private readonly projectRoot:
      string,
    private readonly storage?:
      Pick<
        Storage,
        "listExecutions"
      >
  ) {}

  private async runtimeSurfaceSamples():
    Promise<
      RuntimeSurfaceSample[]
    > {
    if (!this.storage) {
      return [];
    }

    const executions =
      await this.storage
        .listExecutions();

    const samples:
      RuntimeSurfaceSample[] =
      [];

    for (
      const execution
      of executions
    ) {
      if (
        execution.status !==
          "suspended"
      ) {
        continue;
      }

      const created =
        execution.history
          .filter(
            entry =>
              entry.kind ===
              "suspension_created"
          );

      for (
        const entry
        of created
      ) {
        const resolved =
          execution.history
            .some(
              later =>
                (
                  later.kind ===
                    "suspension_resolved" ||
                  later.kind ===
                    "suspension_cancelled"
                ) &&
                later.suspensionId ===
                  entry.suspensionId
            );

        if (resolved) {
          continue;
        }

        const input =
          entry.input as
            any;

        const kind =
          input?.kind ??
          input?.props?.kind ??
          input?.data?.view?.kind;

        const data =
          input?.data ??
          input?.props?.data ??
          input?.data?.view?.data;

        if (
          typeof kind ===
            "string"
        ) {
          samples.push({
            kind,
            data
          });
        }
      }
    }

    return samples;
  }

  async analyze(
    spec:
      BusinessSpec,
    artifacts:
      GeneratedArtifact[]
  ) {
    const before =
      await buildProjectGraph(
        this.projectRoot
      );

    const packageNode =
      before.nodes
        .find(
          node =>
            node.kind ===
              "package" &&
            node.id ===
              spec.packageName
        );

    const packageDir =
      packageNode?.file
        ? dirname(
            packageNode.file
          )
        : packageFallbackDir(
            spec.packageName
          );

    const temp =
      await mkdtemp(
        join(
          tmpdir(),
          "uair-change-candidate-"
        )
      );

    try {
      await cp(
        this.projectRoot,
        temp,
        {
          recursive: true,
          force: true
        }
      );

      const candidatePackageDir =
        join(
          temp,
          packageDir
        );

      /**
       * ArtifactImplementer contract is a complete candidate package.
       * Change analysis therefore replaces the target package rather than
       * overlaying new files on top of stale source. Overlay semantics can
       * manufacture duplicate durable IDs after a legitimate file move.
       */
      if (
        candidatePackageDir ===
          temp
      ) {
        for (
          const entry
          of await readdir(
            temp
          )
        ) {
          await rm(
            join(
              temp,
              entry
            ),
            {
              recursive:
                true,
              force:
                true
            }
          );
        }
      } else {
        await rm(
          candidatePackageDir,
          {
            recursive:
              true,
            force:
              true
          }
        );

        await mkdir(
          candidatePackageDir,
          {
            recursive:
              true
          }
        );
      }

      await materializeArtifacts(
        candidatePackageDir,
        artifacts
      );

      const after =
        await buildProjectGraph(
          temp
        );

      const changeSet =
        createChangeSet(
          before,
          after
        );

      const safety =
        analyzeChangeSetSafety(
          changeSet
        );

      const contractCompatibility =
        analyzeContractCompatibility(
          before,
          after,
          await this
            .runtimeSurfaceSamples()
        );

      const architectureGovernance =
        await analyzeProjectGovernance(
          after
        );

      return {
        changeSet,
        safety,
        contractCompatibility,
        architectureGovernance
      };
    } finally {
      await rm(
        temp,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
}
