import {
  readFile,
  readdir
} from "node:fs/promises";

import {
  createHash
} from "node:crypto";

import {
  dirname,
  extname,
  join,
  relative,
  resolve
} from "node:path";

import ts from "typescript";

import type {
  ContractShape,
  ProjectGraph,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectInventory
} from "./types.js";

import type {
  ProjectInspector
} from "./interfaces.js";

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

async function walk(
  dir: string
): Promise<string[]> {
  const entries =
    await readdir(
      dir,
      {
        withFileTypes: true
      }
    );

  const result:
    string[] = [];

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
      result.push(
        ...await walk(path)
      );
    } else {
      result.push(path);
    }
  }

  return result;
}

function key(
  kind: string,
  id: string
) {
  return `${kind}:${id}`;
}

function fingerprint(
  value: string
) {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex")
    .slice(0, 16);
}


function typeToContractShape(
  checker:
    ts.TypeChecker,
  type:
    ts.Type,
  depth = 0
): ContractShape {
  if (
    depth > 6 ||
    (
      type.flags &
      (
        ts.TypeFlags.Any |
        ts.TypeFlags.Unknown
      )
    )
  ) {
    return {
      kind:
        "unknown"
    };
  }

  if (
    type.flags &
    ts.TypeFlags.String
  ) {
    return {
      kind:
        "primitive",
      type:
        "string"
    };
  }

  if (
    type.flags &
    ts.TypeFlags.Number
  ) {
    return {
      kind:
        "primitive",
      type:
        "number"
    };
  }

  if (
    type.flags &
    ts.TypeFlags.Boolean
  ) {
    return {
      kind:
        "primitive",
      type:
        "boolean"
    };
  }

  if (
    type.flags &
    ts.TypeFlags.Null
  ) {
    return {
      kind:
        "primitive",
      type:
        "null"
    };
  }

  if (
    type.flags &
    ts.TypeFlags.Undefined
  ) {
    return {
      kind:
        "primitive",
      type:
        "undefined"
    };
  }

  if (
    type.isStringLiteral()
  ) {
    return {
      kind:
        "literal",
      value:
        type.value
    };
  }

  if (
    type.isNumberLiteral()
  ) {
    return {
      kind:
        "literal",
      value:
        type.value
    };
  }

  if (
    type.flags &
    ts.TypeFlags.BooleanLiteral
  ) {
    return {
      kind:
        "literal",
      value:
        checker.typeToString(
          type
        ) === "true"
    };
  }

  if (
    type.isUnion()
  ) {
    return {
      kind:
        "union",
      options:
        type.types
          .map(
            item =>
              typeToContractShape(
                checker,
                item,
                depth + 1
              )
          )
    };
  }

  if (
    checker.isArrayType(
      type
    ) ||
    checker.isTupleType(
      type
    )
  ) {
    const reference =
      type as
        ts.TypeReference;

    const element =
      checker.getTypeArguments(
        reference
      )[0];

    return {
      kind:
        "array",
      element:
        element
          ? typeToContractShape(
              checker,
              element,
              depth + 1
            )
          : {
              kind:
                "unknown"
            }
    };
  }

  if (
    type.flags &
    ts.TypeFlags.Object
  ) {
    const properties:
      Record<
        string,
        {
          required:
            boolean;
          shape:
            ContractShape;
        }
      > = {};

    for (
      const property
      of checker
        .getPropertiesOfType(
          type
        )
    ) {
      const declaration =
        property
          .valueDeclaration ??
        property
          .declarations?.[0];

      if (!declaration) {
        continue;
      }

      const propertyType =
        checker.getTypeOfSymbolAtLocation(
          property,
          declaration
        );

      properties[
        property.name
      ] = {
        required:
          !(
            property.flags &
            ts.SymbolFlags.Optional
          ),
        shape:
          typeToContractShape(
            checker,
            propertyType,
            depth + 1
          )
      };
    }

    return {
      kind:
        "object",
      properties
    };
  }

  return {
    kind:
      "unknown"
  };
}

function surfaceActionContract(
  checker:
    ts.TypeChecker,
  call:
    ts.CallExpression
): ContractShape {
  const valueTypeNode =
    call.typeArguments?.[1];

  if (!valueTypeNode) {
    return {
      kind:
        "unknown"
    };
  }

  const valueShape =
    typeToContractShape(
      checker,
      checker.getTypeFromTypeNode(
        valueTypeNode
      )
    );

  return {
    kind:
      "object",
    properties: {
      type: {
        required:
          true,
        shape: {
          kind:
            "primitive",
          type:
            "string"
        }
      },
      value: {
        required:
          false,
        shape:
          valueShape
      },
      id: {
        required:
          false,
        shape: {
          kind:
            "primitive",
          type:
            "string"
        }
      },
      label: {
        required:
          false,
        shape: {
          kind:
            "primitive",
          type:
            "string"
        }
      },
      metadata: {
        required:
          false,
        shape: {
          kind:
            "unknown"
        }
      }
    }
  };
}

function awaitedContractShape(
  checker:
    ts.TypeChecker,
  type:
    ts.Type
) {
  const getAwaitedType =
    (
      checker as
        ts.TypeChecker & {
          getAwaitedType?:
            (
              value:
                ts.Type
            ) =>
              ts.Type |
              undefined;
        }
    )
      .getAwaitedType;

  const awaited =
    getAwaitedType
      ? getAwaitedType.call(
          checker,
          type
        ) ??
        type
      : type;

  return typeToContractShape(
    checker,
    awaited
  );
}

function functionContract(
  checker:
    ts.TypeChecker,
  functionNode:
    ts.ArrowFunction |
    ts.FunctionExpression
) {
  const signature =
    checker.getSignatureFromDeclaration(
      functionNode
    );

  const inputParameter =
    functionNode.parameters[0];

  return {
    input:
      inputParameter
        ? typeToContractShape(
            checker,
            checker.getTypeAtLocation(
              inputParameter
            )
          )
        : undefined,
    output:
      signature
        ? awaitedContractShape(
            checker,
            checker.getReturnTypeOfSignature(
              signature
            )
          )
        : undefined
  };
}

function runContract(
  checker:
    ts.TypeChecker,
  object:
    ts.ObjectLiteralExpression
) {
  const run =
    object.properties
      .find(
        property =>
          (
            ts.isMethodDeclaration(
              property
            ) ||
            ts.isPropertyAssignment(
              property
            )
          ) &&
          (
            (
              ts.isIdentifier(
                property.name
              ) &&
              property.name.text ===
                "run"
            ) ||
            (
              ts.isStringLiteral(
                property.name
              ) &&
              property.name.text ===
                "run"
            )
          )
      );

  if (!run) {
    return undefined;
  }

  const functionNode =
    ts.isMethodDeclaration(
      run
    )
      ? run
      : ts.isPropertyAssignment(
          run
        ) &&
        (
          ts.isArrowFunction(
            run.initializer
          ) ||
          ts.isFunctionExpression(
            run.initializer
          )
        )
        ? run.initializer
        : undefined;

  if (!functionNode) {
    return undefined;
  }

  const signature =
    checker.getSignatureFromDeclaration(
      functionNode
    );

  const inputParameter =
    functionNode.parameters[0];

  return {
    input:
      inputParameter
        ? typeToContractShape(
            checker,
            checker.getTypeAtLocation(
              inputParameter
            )
          )
        : undefined,
    output:
      signature
        ? awaitedContractShape(
            checker,
            checker.getReturnTypeOfSignature(
              signature
            )
          )
        : undefined
  };
}

function literalText(
  node:
    ts.Node | undefined
) {
  if (
    node &&
    (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(
        node
      )
    )
  ) {
    return node.text;
  }

  return undefined;
}

function objectPropertyLiteral(
  object:
    ts.ObjectLiteralExpression,
  name: string
) {
  const property =
    object.properties
      .find(
        item =>
          ts.isPropertyAssignment(
            item
          ) &&
          (
            (
              ts.isIdentifier(
                item.name
              ) &&
              item.name.text ===
                name
            ) ||
            (
              ts.isStringLiteral(
                item.name
              ) &&
              item.name.text ===
                name
            )
          )
      );

  if (
    property &&
    ts.isPropertyAssignment(
      property
    )
  ) {
    return literalText(
      property.initializer
    );
  }

  return undefined;
}

function calleeName(
  expression:
    ts.LeftHandSideExpression
) {
  if (
    ts.isIdentifier(
      expression
    )
  ) {
    return expression.text;
  }

  if (
    ts.isPropertyAccessExpression(
      expression
    )
  ) {
    return expression
      .name.text;
  }

  return undefined;
}

function packageTarget(
  specifier: string
) {
  if (
    !specifier.startsWith(
      "@"
    )
  ) {
    return specifier;
  }

  return specifier
    .split("/")
    .slice(
      0,
      2
    )
    .join("/");
}

async function findPackageName(
  rootDir: string,
  file: string
) {
  let current =
    dirname(file);

  const stop =
    resolve(rootDir);

  while (
    current.startsWith(
      stop
    )
  ) {
    try {
      const raw =
        await readFile(
          join(
            current,
            "package.json"
          ),
          "utf8"
        );

      const pkg =
        JSON.parse(raw);

      if (
        typeof pkg.name ===
          "string"
      ) {
        return pkg.name;
      }
    } catch {}

    if (
      current === stop
    ) {
      break;
    }

    current =
      dirname(current);
  }

  return undefined;
}

function symbolDeclarationKey(
  checker:
    ts.TypeChecker,
  expression:
    ts.Expression,
  declarationKeys:
    Map<
      ts.Node,
      string
    >
) {
  let symbol =
    checker.getSymbolAtLocation(
      expression
    );

  if (!symbol) {
    return undefined;
  }

  if (
    symbol.flags &
    ts.SymbolFlags.Alias
  ) {
    try {
      symbol =
        checker.getAliasedSymbol(
          symbol
        );
    } catch {}
  }

  for (
    const declaration
    of symbol.declarations ??
    []
  ) {
    let current:
      ts.Node | undefined =
      declaration;

    while (current) {
      const found =
        declarationKeys.get(
          current
        );

      if (found) {
        return found;
      }

      current =
        current.parent;
    }
  }

  return undefined;
}

function ownerDeclarationKey(
  node: ts.Node,
  declarationKeys:
    Map<
      ts.Node,
      string
    >
) {
  let current:
    ts.Node | undefined =
    node;

  while (current) {
    const found =
      declarationKeys.get(
        current
      );

    if (found) {
      return found;
    }

    current =
      current.parent;
  }

  return undefined;
}

export async function buildProjectGraph(
  rootDir: string
): Promise<ProjectGraph> {
  const root =
    resolve(rootDir);

  const allFiles =
    await walk(root);

  const sourceFiles =
    allFiles.filter(
      file =>
        [
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mjs",
          ".cjs"
        ].includes(
          extname(file)
        )
    );

  const nodes:
    ProjectGraphNode[] = [];

  const edges:
    ProjectGraphEdge[] = [];

  const declarationConflicts:
    NonNullable<
      ProjectGraph[
        "declarationConflicts"
      ]
    > = [];

  const nodeByKey =
    new Map<
      string,
      ProjectGraphNode
    >();

  const addNode =
    (
      node:
        ProjectGraphNode
    ) => {
      const existing =
        nodeByKey.get(
          node.key
        );

      if (existing) {
        const existingVersion =
          existing.version ??
          "1";

        const nextVersion =
          node.version ??
          "1";

        if (
          existing.kind ===
            "workflow" &&
          node.kind ===
            "workflow" &&
          existingVersion !==
            nextVersion
        ) {
          if (
            nextVersion.localeCompare(
              existingVersion,
              undefined,
              {
                numeric: true,
                sensitivity:
                  "base"
              }
            ) > 0
          ) {
            const index =
              nodes.indexOf(
                existing
              );

            if (index >= 0) {
              nodes[index] =
                node;
            }

            nodeByKey.set(
              node.key,
              node
            );
          }

          return;
        }

        if (
          (
            existing.file !==
              node.file ||
            existing.fingerprint !==
              node.fingerprint
          ) &&
          node.kind !==
            "package"
        ) {
          declarationConflicts.push({
            key:
              node.key,
            first:
              existing,
            duplicate:
              node
          });
        }

        return;
      }

      nodeByKey.set(
        node.key,
        node
      );

      nodes.push(node);
    };

  const addEdge =
    (
      edge:
        ProjectGraphEdge
    ) => {
      if (
        edges.some(
          item =>
            item.from ===
              edge.from &&
            item.to ===
              edge.to &&
            item.kind ===
              edge.kind
        )
      ) {
        return;
      }

      edges.push(edge);
    };

  for (
    const file
    of allFiles
  ) {
    if (
      !file.endsWith(
        "package.json"
      )
    ) {
      continue;
    }

    try {
      const pkg =
        JSON.parse(
          await readFile(
            file,
            "utf8"
          )
        );

      if (
        typeof pkg.name !==
          "string"
      ) {
        continue;
      }

      addNode({
        key:
          key(
            "package",
            pkg.name
          ),
        kind:
          "package",
        id:
          pkg.name,
        packageName:
          pkg.name,
        version:
          typeof pkg.version ===
            "string"
            ? pkg.version
            : undefined,
        file:
          relative(
            root,
            file
          ),
        fingerprint:
          fingerprint(
            JSON.stringify(pkg)
          )
      });

      const dependencies = {
        ...pkg.dependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies
      };

      for (
        const dependency
        of Object.keys(
          dependencies
        )
      ) {
        addEdge({
          from:
            key(
              "package",
              pkg.name
            ),
          to:
            key(
              "package",
              packageTarget(
                dependency
              )
            ),
          kind:
            "imports"
        });
      }
    } catch {}
  }

  const program =
    ts.createProgram(
      sourceFiles,
      {
        target:
          ts.ScriptTarget.ES2022,
        module:
          ts.ModuleKind.NodeNext,
        moduleResolution:
          ts.ModuleResolutionKind.NodeNext,
        allowJs:
          true,
        checkJs:
          false,
        skipLibCheck:
          true,
        noEmit:
          true
      }
    );

  const checker =
    program.getTypeChecker();

  const declarationKeys =
    new Map<
      ts.Node,
      string
    >();

  const packageBySource =
    new Map<
      ts.SourceFile,
      string | undefined
    >();

  /**
   * Pass 1: discover stable UAIR declarations.
   */
  for (
    const file
    of program
      .getSourceFiles()
  ) {
    if (
      !sourceFiles.includes(
        file.fileName
      )
    ) {
      continue;
    }

    const packageName =
      await findPackageName(
        root,
        file.fileName
      );

    packageBySource.set(
      file,
      packageName
    );

    const packageNode =
      packageName
        ? key(
            "package",
            packageName
          )
        : undefined;

    const visit =
      (
        node: ts.Node
      ) => {
        if (
          ts.isVariableDeclaration(
            node
          ) &&
          ts.isIdentifier(
            node.name
          ) &&
          node.initializer &&
          ts.isCallExpression(
            node.initializer
          )
        ) {
          const call =
            node.initializer;

          const name =
            calleeName(
              call.expression
            );

          const argument =
            call.arguments[0];

          if (
            (
              name ===
                "workflow" ||
              name ===
                "component"
            ) &&
            argument &&
            (
              ts.isStringLiteral(
                argument
              ) ||
              ts.isNoSubstitutionTemplateLiteral(
                argument
              )
            )
          ) {
            const id =
              argument.text;

            const kind =
              name ===
                "workflow"
                ? "workflow"
                : "component";

            const nodeKey =
              key(
                kind,
                id
              );

            const maybeOptions =
              call.arguments[1];

            const handlerArgument =
              call.arguments[
                call.arguments.length -
                1
              ];

            const handler =
              (
                ts.isArrowFunction(
                  handlerArgument
                ) ||
                ts.isFunctionExpression(
                  handlerArgument
                )
              )
                ? handlerArgument
                : undefined;

            const graphNode:
              ProjectGraphNode = {
                key:
                  nodeKey,
                kind,
                id,
                packageName,
                symbolName:
                  node.name.text,
                file:
                  relative(
                    root,
                    file.fileName
                  ),
                fingerprint:
                  fingerprint(
                    node.getText(
                      file
                    )
                  ),
                contract:
                  kind ===
                    "component" &&
                  handler
                    ? functionContract(
                        checker,
                        handler
                      )
                    : undefined
              };

            if (
              kind ===
                "workflow"
            ) {
              graphNode.version =
                (
                  maybeOptions &&
                  ts.isObjectLiteralExpression(
                    maybeOptions
                  )
                )
                  ? objectPropertyLiteral(
                      maybeOptions,
                      "version"
                    ) ??
                    "1"
                  : "1";
            }

            addNode(
              graphNode
            );

            declarationKeys.set(
              node,
              nodeKey
            );

            declarationKeys.set(
              call,
              nodeKey
            );

            if (
              packageNode
            ) {
              addEdge({
                from:
                  packageNode,
                to:
                  nodeKey,
                kind:
                  "contains"
              });
            }
          }

          if (
            name ===
              "interaction" &&
            argument &&
            (
              ts.isStringLiteral(
                argument
              ) ||
              ts.isNoSubstitutionTemplateLiteral(
                argument
              )
            )
          ) {
            const id =
              argument.text;

            const nodeKey =
              key(
                "surface",
                id
              );

            const dataType =
              call.typeArguments?.[0];

            const resultType =
              call.typeArguments?.[1];

            addNode({
              key:
                nodeKey,
              kind:
                "surface",
              id,
              packageName,
              file:
                relative(
                  root,
                  file.fileName
                ),
              fingerprint:
                fingerprint(
                  node.getText(
                    file
                  )
                ),
              contract: {
                data:
                  dataType
                    ? typeToContractShape(
                        checker,
                        checker.getTypeFromTypeNode(
                          dataType
                        )
                      )
                    : {
                        kind:
                          "unknown"
                      },
                action:
                  resultType
                    ? typeToContractShape(
                        checker,
                        checker.getTypeFromTypeNode(
                          resultType
                        )
                      )
                    : {
                        kind:
                          "unknown"
                      }
              }
            });

            declarationKeys.set(
              node,
              nodeKey
            );

            declarationKeys.set(
              call,
              nodeKey
            );

            if (
              packageNode
            ) {
              addEdge({
                from:
                  packageNode,
                to:
                  nodeKey,
                kind:
                  "contains"
              });
            }
          }

          if (
            argument &&
            ts.isObjectLiteralExpression(
              argument
            ) &&
            (
              name ===
                "workflow" ||
              name ===
                "component" ||
              name ===
                "capability"
            )
          ) {
            const id =
              objectPropertyLiteral(
                argument,
                "id"
              );

            if (id) {
              const kind =
                name ===
                  "workflow"
                  ? "workflow"
                  : name ===
                      "component"
                    ? "component"
                    : "capability";

              const nodeKey =
                key(
                  kind,
                  id
                );

              const graphNode:
                ProjectGraphNode = {
                  key:
                    nodeKey,
                  kind,
                  id,
                  packageName,
                  symbolName:
                    node.name.text,
                  file:
                    relative(
                      root,
                      file.fileName
                    ),
                  fingerprint:
                    fingerprint(
                      node.getText(
                        file
                      )
                    ),
                  contract:
                    (
                      kind ===
                        "component" ||
                      kind ===
                        "capability"
                    )
                      ? runContract(
                          checker,
                          argument
                        )
                      : undefined
                };

              if (
                kind ===
                "workflow"
              ) {
                graphNode.version =
                  objectPropertyLiteral(
                    argument,
                    "version"
                  ) ??
                  "1";
              }

              addNode(
                graphNode
              );

              declarationKeys.set(
                node,
                nodeKey
              );

              declarationKeys.set(
                call,
                nodeKey
              );

              if (
                packageNode
              ) {
                addEdge({
                  from:
                    packageNode,
                  to:
                    nodeKey,
                  kind:
                    "contains"
                });
              }
            }
          }
        }

        ts.forEachChild(
          node,
          visit
        );
      };

    visit(file);
  }

  /**
   * Pass 2: discover semantic Surface nodes and symbol-level uses.
   */
  for (
    const file
    of program
      .getSourceFiles()
  ) {
    if (
      !sourceFiles.includes(
        file.fileName
      )
    ) {
      continue;
    }

    const packageName =
      packageBySource.get(
        file
      );

    const packageNode =
      packageName
        ? key(
            "package",
            packageName
          )
        : undefined;

    const visit =
      (
        node: ts.Node
      ) => {
        if (
          ts.isImportDeclaration(
            node
          )
        ) {
          const specifier =
            literalText(
              node.moduleSpecifier
            );

          if (
            packageNode &&
            specifier &&
            !specifier.startsWith(
              "."
            )
          ) {
            addEdge({
              from:
                packageNode,
              to:
                key(
                  "package",
                  packageTarget(
                    specifier
                  )
                ),
              kind:
                "imports"
            });
          }
        }

        if (
          ts.isCallExpression(
            node
          )
        ) {
          const name =
            calleeName(
              node.expression
            );

          const owner =
            ownerDeclarationKey(
              node,
              declarationKeys
            );

          if (
            name ===
              "surface" &&
            node.arguments[0] &&
            ts.isObjectLiteralExpression(
              node.arguments[0]
            )
          ) {
            const kindId =
              objectPropertyLiteral(
                node.arguments[0],
                "kind"
              );

            if (kindId) {
              const surfaceKey =
                key(
                  "surface",
                  kindId
                );

              addNode({
                key:
                  surfaceKey,
                kind:
                  "surface",
                id:
                  kindId,
                packageName,
                file:
                  relative(
                    root,
                    file.fileName
                  ),
                fingerprint:
                  fingerprint(
                    node.getText(
                      file
                    )
                  ),
                contract: {
                  data:
                    (() => {
                      const dataProperty =
                        node.arguments[0]
                          .properties
                          .find(
                            property =>
                              ts.isPropertyAssignment(
                                property
                              ) &&
                              (
                                (
                                  ts.isIdentifier(
                                    property.name
                                  ) &&
                                  property.name.text ===
                                    "data"
                                ) ||
                                (
                                  ts.isStringLiteral(
                                    property.name
                                  ) &&
                                  property.name.text ===
                                    "data"
                                )
                              )
                          );

                      return (
                        dataProperty &&
                        ts.isPropertyAssignment(
                          dataProperty
                        )
                      )
                        ? typeToContractShape(
                            checker,
                            checker.getTypeAtLocation(
                              dataProperty.initializer
                            )
                          )
                        : {
                            kind:
                              "unknown"
                          };
                    })(),
                  action:
                    surfaceActionContract(
                      checker,
                      node
                    )
                }
              });

              if (
                packageNode
              ) {
                addEdge({
                  from:
                    packageNode,
                  to:
                    surfaceKey,
                  kind:
                    "contains"
                });
              }

              if (owner) {
                addEdge({
                  from:
                    owner,
                  to:
                    surfaceKey,
                  kind:
                    "uses"
                });
              }
            }
          }

          if (
            owner &&
            name !==
              "workflow" &&
            name !==
              "component" &&
            name !==
              "capability" &&
            name !==
              "surface"
          ) {
            const target =
              symbolDeclarationKey(
                checker,
                node.expression,
                declarationKeys
              );

            if (
              target &&
              target !==
                owner
            ) {
              addEdge({
                from:
                  owner,
                to:
                  target,
                kind:
                  "uses"
              });
            }
          }
        }

        ts.forEachChild(
          node,
          visit
        );
      };

    visit(file);
  }

  return {
    rootDir:
      root,
    nodes,
    edges,
    declarationConflicts
  };
}

export function inventoryFromProjectGraph(
  graph:
    ProjectGraph
): ProjectInventory {
  return {
    packages:
      graph.nodes
        .filter(
          item =>
            item.kind ===
            "package"
        )
        .map(
          item =>
            item.id
        ),

    capabilities:
      graph.nodes
        .filter(
          item =>
            item.kind ===
              "capability" ||
            item.kind ===
              "component"
        )
        .map(
          item =>
            item.id
        ),

    capabilityProviders:
      Object.fromEntries(
        graph.nodes
          .filter(
            item =>
              item.kind ===
                "capability" ||
              item.kind ===
                "component"
          )
          .map(
            item => [
              item.id,
              {
                packageName:
                  item.packageName,
                exportName:
                  item.symbolName
              }
            ]
          )
      ),

    workflows:
      graph.nodes
        .filter(
          item =>
            item.kind ===
            "workflow"
        )
        .map(
          item => ({
            id:
              item.id,
            version:
              item.version ??
              "1"
          })
        ),

    surfaces:
      graph.nodes
        .filter(
          item =>
            item.kind ===
            "surface"
        )
        .map(
          item =>
            item.id
        )
  };
}

export class FsProjectGraphInspector
  implements ProjectInspector {
  private lastGraph?:
    ProjectGraph;

  constructor(
    private readonly rootDir:
      string
  ) {}

  async graph() {
    this.lastGraph =
      await buildProjectGraph(
        this.rootDir
      );

    return this.lastGraph;
  }

  async inspect() {
    return inventoryFromProjectGraph(
      await this.graph()
    );
  }

  currentGraph() {
    return this.lastGraph;
  }
}
