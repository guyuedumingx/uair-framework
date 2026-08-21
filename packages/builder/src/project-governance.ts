import {
  readFile,
  readdir
} from "node:fs/promises";

import {
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep
} from "node:path";

import type {
  ArchitectureIssue,
  ImpactPath,
  ProjectGovernancePolicy,
  ProjectGovernanceReport,
  ProjectGraph,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectImpactReport
} from "./types.js";

const DEFAULT_MAX_DIRECT_USES =
  15;

const DEFAULT_MAX_WORKFLOW_DEPTH =
  8;

const PROJECT_GRAPH_IGNORED_DIRECTORIES =
  new Set([
    "node_modules",
    "dist",
    ".git",
    ".uair",
    "scripts",
    "test",
    "tests",
    "__tests__",
    "fixture",
    "fixtures"
  ]);

function nodeMap(
  graph:
    ProjectGraph
) {
  return new Map(
    graph.nodes.map(
      node => [
        node.key,
        node
      ]
    )
  );
}

function outgoing(
  graph:
    ProjectGraph,
  from: string,
  kinds?:
    ProjectGraphEdge["kind"][]
) {
  return graph.edges.filter(
    edge =>
      edge.from ===
        from &&
      (
        !kinds ||
        kinds.includes(
          edge.kind
        )
      )
  );
}

function cyclesFor(
  keys:
    Set<string>,
  edges:
    ProjectGraphEdge[]
) {
  const adjacency =
    new Map<
      string,
      string[]
    >();

  for (
    const key
    of keys
  ) {
    adjacency.set(
      key,
      []
    );
  }

  for (
    const edge
    of edges
  ) {
    if (
      keys.has(
        edge.from
      ) &&
      keys.has(
        edge.to
      )
    ) {
      adjacency
        .get(
          edge.from
        )!
        .push(
          edge.to
        );
    }
  }

  const found:
    string[][] = [];

  const visiting =
    new Set<string>();

  const visited =
    new Set<string>();

  const stack:
    string[] = [];

  const canonical =
    new Set<string>();

  const visit =
    (
      key: string
    ) => {
      if (
        visiting.has(
          key
        )
      ) {
        const index =
          stack.indexOf(
            key
          );

        if (
          index >= 0
        ) {
          const cycle =
            [
              ...stack.slice(
                index
              ),
              key
            ];

          const body =
            cycle.slice(
              0,
              -1
            );

          const variants =
            body.map(
              (
                _,
                offset
              ) =>
                [
                  ...body.slice(
                    offset
                  ),
                  ...body.slice(
                    0,
                    offset
                  )
                ].join(
                  "→"
                )
            );

          const signature =
            variants
              .sort()[0];

          if (
            !canonical.has(
              signature
            )
          ) {
            canonical.add(
              signature
            );

            found.push(
              cycle
            );
          }
        }

        return;
      }

      if (
        visited.has(
          key
        )
      ) {
        return;
      }

      visiting.add(
        key
      );

      stack.push(
        key
      );

      for (
        const next
        of adjacency.get(
          key
        ) ??
        []
      ) {
        visit(
          next
        );
      }

      stack.pop();

      visiting.delete(
        key
      );

      visited.add(
        key
      );
    };

  for (
    const key
    of keys
  ) {
    visit(
      key
    );
  }

  return found;
}

function workflowDepth(
  graph:
    ProjectGraph,
  start: string,
  workflowKeys:
    Set<string>
) {
  const memo =
    new Map<
      string,
      number
    >();

  const visit =
    (
      key: string,
      path:
        Set<string>
    ): number => {
      if (
        path.has(
          key
        )
      ) {
        return 0;
      }

      const cached =
        memo.get(
          key
        );

      if (
        cached !==
          undefined
      ) {
        return cached;
      }

      const next =
        outgoing(
          graph,
          key,
          [
            "uses"
          ]
        )
          .map(
            edge =>
              edge.to
          )
          .filter(
            key =>
              workflowKeys.has(
                key
              )
          );

      if (
        next.length ===
          0
      ) {
        memo.set(
          key,
          1
        );

        return 1;
      }

      const nextPath =
        new Set(
          path
        );

      nextPath.add(
        key
      );

      const depth =
        1 +
        Math.max(
          ...next.map(
            item =>
              visit(
                item,
                nextPath
              )
          )
        );

      memo.set(
        key,
        depth
      );

      return depth;
    };

  return visit(
    start,
    new Set()
  );
}

async function walkSource(
  root: string
) {
  const files:
    string[] = [];

  const visit =
    async (
      dir: string
    ) => {
      const entries =
        await readdir(
          dir,
          {
            withFileTypes:
              true
          }
        );

      for (
        const entry
        of entries
      ) {
        if (
          PROJECT_GRAPH_IGNORED_DIRECTORIES
            .has(
              entry.name
            )
        ) {
          continue;
        }

        const path =
          join(
            dir,
            entry.name
          );

        if (
          entry.isDirectory()
        ) {
          await visit(
            path
          );

          continue;
        }

        if (
          [
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mjs",
            ".cjs"
          ].includes(
            extname(
              entry.name
            )
          )
        ) {
          files.push(
            path
          );
        }
      }
    };

  await visit(
    root
  );

  return files;
}

function packageTarget(
  specifier:
    string
) {
  if (
    specifier.startsWith(
      "@"
    )
  ) {
    return specifier
      .split("/")
      .slice(
        0,
        2
      )
      .join("/");
  }

  return specifier
    .split("/")[0];
}

function packageDirectories(
  graph:
    ProjectGraph
) {
  return graph.nodes
    .filter(
      node =>
        node.kind ===
          "package" &&
        node.file
    )
    .map(
      node => ({
        packageName:
          node.id,
        directory:
          resolve(
            graph.rootDir,
            dirname(
              node.file!
            )
          )
      })
    )
    .sort(
      (
        left,
        right
      ) =>
        right.directory
          .length -
        left.directory
          .length
    );
}

function packageForFile(
  packages:
    ReturnType<
      typeof packageDirectories
    >,
  file: string
) {
  const absolute =
    resolve(
      file
    );

  return packages.find(
    item =>
      absolute ===
        item.directory ||
      absolute.startsWith(
        item.directory +
        sep
      )
  )?.packageName;
}

async function exportedPackageSpecifiers(
  packages:
    ReturnType<
      typeof packageDirectories
    >
) {
  const specifiers =
    new Set<string>();

  for (const item of packages) {
    try {
      const pkg =
        JSON.parse(
          await readFile(
            join(
              item.directory,
              "package.json"
            ),
            "utf8"
          )
        );

      if (
        !pkg.exports ||
        typeof pkg.exports !==
          "object" ||
        Array.isArray(
          pkg.exports
        )
      ) {
        continue;
      }

      for (
        const subpath
        of Object.keys(
          pkg.exports
        )
      ) {
        if (
          !subpath.startsWith(
            "./"
          )
        ) {
          continue;
        }

        specifiers.add(
          `${item.packageName}/${subpath.slice(2)}`
        );
      }
    } catch {}
  }

  return specifiers;
}

function importSpecifiers(
  source: string
) {
  const values =
    new Set<string>();

  const patterns = [
    /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (
    const pattern
    of patterns
  ) {
    let match:
      RegExpExecArray |
      null;

    while (
      (
        match =
          pattern.exec(
            source
          )
      )
    ) {
      values.add(
        match[1]
      );
    }
  }

  return [
    ...values
  ];
}

function isPrivateDeepImport(
  specifier: string,
  allowed:
    Set<string>
) {
  if (
    allowed.has(
      specifier
    )
  ) {
    return false;
  }

  return (
    /\/(?:src|internal|dist)(?:\/|$)/.test(
      specifier
    ) ||
    /\/\.\.(?:\/|$)/.test(
      specifier
    )
  );
}

export async function analyzeProjectGovernance(
  graph:
    ProjectGraph,
  policy:
    ProjectGovernancePolicy =
      {}
): Promise<
  ProjectGovernanceReport
> {
  const issues:
    ArchitectureIssue[] = [];

  const nodes =
    nodeMap(
      graph
    );

  for (
    const conflict
    of graph
      .declarationConflicts ??
    []
  ) {
    issues.push({
      severity:
        "error",
      code:
        "DUPLICATE_DURABLE_ID",
      message:
        `${conflict.key} is declared more than once (${conflict.first.file ?? "unknown"} and ${conflict.duplicate.file ?? "unknown"}).`,
      nodeKey:
        conflict.key,
      packageName:
        conflict.duplicate
          .packageName,
      file:
        conflict.duplicate
          .file
    });
  }

  const packageKeys =
    new Set(
      graph.nodes
        .filter(
          node =>
            node.kind ===
              "package"
        )
        .map(
          node =>
            node.key
        )
    );

  for (
    const cycle
    of cyclesFor(
      packageKeys,
      graph.edges.filter(
        edge =>
          edge.kind ===
            "imports"
      )
    )
  ) {
    const ids =
      cycle.map(
        key =>
          nodes.get(
            key
          )?.id ??
          key
      );

    issues.push({
      severity:
        "error",
      code:
        "PACKAGE_DEPENDENCY_CYCLE",
      message:
        `Package dependency cycle: ${ids.join(" → ")}.`,
      path:
        ids
    });
  }

  const workflowKeys =
    new Set(
      graph.nodes
        .filter(
          node =>
            node.kind ===
              "workflow"
        )
        .map(
          node =>
            node.key
        )
    );

  for (
    const cycle
    of cyclesFor(
      workflowKeys,
      graph.edges.filter(
        edge =>
          edge.kind ===
            "uses"
      )
    )
  ) {
    const ids =
      cycle.map(
        key =>
          nodes.get(
            key
          )?.id ??
          key
      );

    issues.push({
      severity:
        "error",
      code:
        "WORKFLOW_DEPENDENCY_CYCLE",
      message:
        `Workflow dependency cycle: ${ids.join(" → ")}.`,
      path:
        ids
    });
  }

  const maxDirectUses =
    policy.maxDirectUses ??
    DEFAULT_MAX_DIRECT_USES;

  for (
    const node
    of graph.nodes
  ) {
    if (
      node.kind !==
        "workflow"
    ) {
      continue;
    }

    const directUses =
      outgoing(
        graph,
        node.key,
        [
          "uses"
        ]
      );

    if (
      directUses.length >
        maxDirectUses
    ) {
      issues.push({
        severity:
          "warning",
        code:
          "HIGH_WORKFLOW_FAN_OUT",
        message:
          `Workflow ${node.id} directly uses ${directUses.length} durable nodes; policy threshold is ${maxDirectUses}.`,
        nodeKey:
          node.key,
        packageName:
          node.packageName,
        file:
          node.file
      });
    }

    const depth =
      workflowDepth(
        graph,
        node.key,
        workflowKeys
      );

    const maxDepth =
      policy
        .maxWorkflowDependencyDepth ??
      DEFAULT_MAX_WORKFLOW_DEPTH;

    if (
      depth >
        maxDepth
    ) {
      issues.push({
        severity:
          "warning",
        code:
          "DEEP_WORKFLOW_CHAIN",
        message:
          `Workflow ${node.id} has dependency depth ${depth}; policy threshold is ${maxDepth}.`,
        nodeKey:
          node.key,
        packageName:
          node.packageName,
        file:
          node.file
      });
    }
  }

  for (
    const [
      packageName,
      prefix
    ]
    of Object.entries(
      policy
        .packageNamespaces ??
      {}
    )
  ) {
    for (
      const node
      of graph.nodes
    ) {
      if (
        node.packageName !==
          packageName ||
        node.kind ===
          "package"
      ) {
        continue;
      }

      if (
        !node.id.startsWith(
          prefix
        )
      ) {
        issues.push({
          severity:
            "warning",
          code:
            "PACKAGE_NAMESPACE_MISMATCH",
          message:
            `${node.kind} ${node.id} in ${packageName} does not follow optional namespace prefix "${prefix}".`,
          nodeKey:
            node.key,
          packageName,
          file:
            node.file
        });
      }
    }
  }

  const packageDirs =
    packageDirectories(
      graph
    );

  const allowedDeepImports =
    new Set(
      policy
        .allowedDeepImports ??
      []
    );

  const exportedDeepImports =
    await exportedPackageSpecifiers(
      packageDirs
    );

  for (
    const file
    of await walkSource(
      graph.rootDir
    )
  ) {
    const owner =
      packageForFile(
        packageDirs,
        file
      );

    const source =
      await readFile(
        file,
        "utf8"
      );

    for (
      const specifier
      of importSpecifiers(
        source
      )
    ) {
      if (
        specifier.startsWith(
          "."
        )
      ) {
        continue;
      }

      const target =
        packageTarget(
          specifier
        );

      if (
        !owner ||
        owner ===
          target
      ) {
        continue;
      }

      if (
        isPrivateDeepImport(
          specifier,
          allowedDeepImports
        ) &&
        !exportedDeepImports.has(
          specifier
        )
      ) {
        issues.push({
          severity:
            "error",
          code:
            "CROSS_PACKAGE_PRIVATE_IMPORT",
          message:
            `${owner} imports private implementation path "${specifier}". Use the target package public export/capability contract.`,
          packageName:
            owner,
          file:
            relative(
              graph.rootDir,
              file
            )
        });
      }
    }
  }

  const reverseUseCount =
    new Map<
      string,
      number
    >();

  for (
    const edge
    of graph.edges
  ) {
    if (
      edge.kind !==
        "uses"
    ) {
      continue;
    }

    reverseUseCount.set(
      edge.to,
      (
        reverseUseCount.get(
          edge.to
        ) ??
        0
      ) +
      1
    );
  }

  for (
    const [
      key,
      count
    ]
    of reverseUseCount
  ) {
    if (
      count < 20
    ) {
      continue;
    }

    const node =
      nodes.get(
        key
      );

    if (!node) {
      continue;
    }

    issues.push({
      severity:
        "info",
      code:
        "ARCHITECTURE_HOTSPOT",
      message:
        `${node.kind} ${node.id} has ${count} direct dependents and is an architecture hotspot.`,
      nodeKey:
        node.key,
      packageName:
        node.packageName,
      file:
        node.file
    });
  }

  const count =
    (
      severity:
        ArchitectureIssue["severity"]
    ) =>
      issues.filter(
        issue =>
          issue.severity ===
            severity
      ).length;

  return {
    healthy:
      !issues.some(
        issue =>
          issue.severity ===
            "error"
      ),
    issues,
    summary: {
      errors:
        count(
          "error"
        ),
      warnings:
        count(
          "warning"
        ),
      infos:
        count(
          "info"
        ),
      packages:
        graph.nodes.filter(
          node =>
            node.kind ===
              "package"
        ).length,
      workflows:
        graph.nodes.filter(
          node =>
            node.kind ===
              "workflow"
        ).length,
      components:
        graph.nodes.filter(
          node =>
            node.kind ===
              "component"
        ).length,
      edges:
        graph.edges.length
    }
  };
}

export function analyzeProjectImpact(
  graph:
    ProjectGraph,
  nodeKey: string
): ProjectImpactReport {
  const nodes =
    nodeMap(
      graph
    );

  const source =
    nodes.get(
      nodeKey
    );

  if (!source) {
    throw new Error(
      `ProjectGraph node not found: ${nodeKey}`
    );
  }

  const reverse =
    new Map<
      string,
      ProjectGraphEdge[]
    >();

  for (
    const edge
    of graph.edges
  ) {
    const list =
      reverse.get(
        edge.to
      ) ??
      [];

    list.push(
      edge
    );

    reverse.set(
      edge.to,
      list
    );
  }

  const directKeys =
    new Set(
      (
        reverse.get(
          nodeKey
        ) ??
        []
      ).map(
        edge =>
          edge.from
      )
    );

  const paths:
    ImpactPath[] = [];

  const queue: Array<{
    key: string;
    path: string[];
    edgeKinds:
      ProjectGraphEdge["kind"][];
  }> = [
    {
      key:
        nodeKey,
      path: [
        nodeKey
      ],
      edgeKinds: []
    }
  ];

  const shortest =
    new Map<
      string,
      number
    >([
      [
        nodeKey,
        0
      ]
    ]);

  while (
    queue.length
  ) {
    const current =
      queue.shift()!;

    for (
      const edge
      of reverse.get(
        current.key
      ) ??
      []
    ) {
      const next =
        edge.from;

      const nextPath =
        [
          ...current.path,
          next
        ];

      const nextKinds =
        [
          ...current.edgeKinds,
          edge.kind
        ];

      const distance =
        nextPath.length -
        1;

      if (
        (
          shortest.get(
            next
          ) ??
          Number.POSITIVE_INFINITY
        ) <
        distance
      ) {
        continue;
      }

      shortest.set(
        next,
        distance
      );

      const target =
        nodes.get(
          next
        );

      if (
        target
      ) {
        paths.push({
          target,
          path:
            nextPath
              .map(
                key =>
                  nodes.get(
                    key
                  )
              )
              .filter(
                (
                  node
                ): node is
                  ProjectGraphNode =>
                    Boolean(
                      node
                    )
              ),
          edgeKinds:
            nextKinds
        });
      }

      queue.push({
        key:
          next,
        path:
          nextPath,
        edgeKinds:
          nextKinds
      });
    }
  }

  const transitivelyAffected =
    [
      ...new Map(
        paths.map(
          item => [
            item.target.key,
            item.target
          ]
        )
      ).values()
    ];

  return {
    source,
    directlyAffected:
      [
        ...directKeys
      ]
        .map(
          key =>
            nodes.get(
              key
            )
        )
        .filter(
          (
            node
          ): node is
            ProjectGraphNode =>
              Boolean(
                node
              )
        ),
    transitivelyAffected,
    paths
  };
}

function mermaidId(
  key: string
) {
  return `n_${Buffer.from(
    key
  )
    .toString(
      "hex"
    )
    .slice(
      0,
      24
    )}`;
}

function escapeLabel(
  value: string
) {
  return value
    .replaceAll(
      '"',
      '\\"'
    );
}

export function renderProjectGraphMermaid(
  graph:
    ProjectGraph,
  options: {
    includePackages?:
      boolean;
    includeSurfaces?:
      boolean;
  } = {}
) {
  const selected =
    graph.nodes.filter(
      node =>
        (
          options
            .includePackages ??
          true
        ) ||
        node.kind !==
          "package"
    ).filter(
      node =>
        (
          options
            .includeSurfaces ??
          true
        ) ||
        node.kind !==
          "surface"
    );

  const selectedKeys =
    new Set(
      selected.map(
        node =>
          node.key
      )
    );

  const lines = [
    "flowchart LR"
  ];

  for (
    const node
    of selected
  ) {
    const suffix =
      node.kind ===
        "workflow"
        ? `@${node.version ?? "1"}`
        : "";

    lines.push(
      `  ${mermaidId(node.key)}["${escapeLabel(`${node.kind}: ${node.id}${suffix}`)}"]`
    );
  }

  for (
    const edge
    of graph.edges
  ) {
    if (
      !selectedKeys.has(
        edge.from
      ) ||
      !selectedKeys.has(
        edge.to
      )
    ) {
      continue;
    }

    lines.push(
      `  ${mermaidId(edge.from)} -- "${edge.kind}" --> ${mermaidId(edge.to)}`
    );
  }

  return lines.join(
    "\n"
  );
}
