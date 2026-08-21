import {
  mkdir,
  writeFile
} from "node:fs/promises";
import {
  dirname,
  resolve,
  sep
} from "node:path";

import type {
  GeneratedArtifact
} from "./types.js";

function safeTarget(
  root: string,
  relativePath: string
) {
  const base =
    resolve(root);

  const target =
    resolve(
      base,
      relativePath
    );

  if (
    target !== base &&
    !target.startsWith(
      base + sep
    )
  ) {
    throw new Error(
      `Artifact path escapes output directory: ${relativePath}`
    );
  }

  return target;
}

export async function materializeArtifacts(
  outputDir: string,
  artifacts:
    GeneratedArtifact[]
) {
  const written:
    string[] = [];

  for (
    const artifact
    of artifacts
  ) {
    const target =
      safeTarget(
        outputDir,
        artifact.path
      );

    await mkdir(
      dirname(target),
      {
        recursive: true
      }
    );

    await writeFile(
      target,
      artifact.content,
      "utf8"
    );

    written.push(
      target
    );
  }

  return written;
}
