import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";

import {
  spawn
} from "node:child_process";

import {
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

import type {
  ArtifactImplementer,
  RequirementAnalyst,
  SolutionArchitect
} from "./interfaces.js";

import type {
  BusinessSpec,
  BuildPlan,
  GeneratedArtifact,
  ProjectInventory,
  RequirementRequest
} from "./types.js";

export type CodexCliOptions = {
  binary?: string;
  model?: string;
  timeoutMs?: number;
  extraArgs?: string[];
};

type StructuredRun<T> = {
  cwd: string;
  prompt: string;
  schema: unknown;
};

export class CodexCliClient {
  constructor(
    private readonly options:
      CodexCliOptions = {}
  ) {}

  async available() {
    try {
      await this.runProcess(
        [
          "--version"
        ],
        process.cwd(),
        ""
      );

      return true;
    } catch {
      return false;
    }
  }

  async runStructured<T>(
    input:
      StructuredRun<T>
  ): Promise<T> {
    const temp =
      await mkdtemp(
        join(
          tmpdir(),
          "uair-codex-"
        )
      );

    const schemaFile =
      join(
        temp,
        "schema.json"
      );

    const outputFile =
      join(
        temp,
        "last-message.json"
      );

    try {
      await writeFile(
        schemaFile,
        JSON.stringify(
          input.schema,
          null,
          2
        ) +
        "\n",
        "utf8"
      );

      const args = [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--output-schema",
        schemaFile,
        "--output-last-message",
        outputFile
      ];

      if (
        this.options.model
      ) {
        args.push(
          "--model",
          this.options.model
        );
      }

      args.push(
        ...(
          this.options.extraArgs ??
          []
        ),
        "-"
      );

      await this.runProcess(
        args,
        input.cwd,
        input.prompt
      );

      const raw =
        await readFile(
          outputFile,
          "utf8"
        );

      try {
        return JSON.parse(
          raw
        ) as T;
      } catch (
        error: any
      ) {
        throw new Error(
          `Codex returned invalid structured output: ${error?.message ?? String(error)}`
        );
      }
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

  private async runProcess(
    args: string[],
    cwd: string,
    stdin: string
  ) {
    const binary =
      this.options.binary ??
      process.env.CODEX_BIN ??
      "codex";

    const timeoutMs =
      this.options.timeoutMs ??
      10 * 60 * 1000;

    await new Promise<void>(
      (
        resolve,
        reject
      ) => {
        const child =
          spawn(
            binary,
            args,
            {
              cwd,
              env:
                process.env,
              stdio: [
                "pipe",
                "pipe",
                "pipe"
              ]
            }
          );

        let stdout =
          "";

        let stderr =
          "";

        let settled =
          false;

        const timer =
          setTimeout(
            () => {
              if (settled) {
                return;
              }

              settled =
                true;

              child.kill(
                "SIGKILL"
              );

              reject(
                new Error(
                  `Codex timed out after ${timeoutMs}ms`
                )
              );
            },
            timeoutMs
          );

        child.stdout
          .setEncoding(
            "utf8"
          );

        child.stderr
          .setEncoding(
            "utf8"
          );

        child.stdout.on(
          "data",
          chunk => {
            stdout +=
              chunk;
          }
        );

        child.stderr.on(
          "data",
          chunk => {
            stderr +=
              chunk;
          }
        );

        child.on(
          "error",
          error => {
            if (settled) {
              return;
            }

            settled =
              true;

            clearTimeout(
              timer
            );

            reject(
              new Error(
                `Unable to start Codex CLI (${binary}): ${error.message}`
              )
            );
          }
        );

        child.on(
          "close",
          code => {
            if (settled) {
              return;
            }

            settled =
              true;

            clearTimeout(
              timer
            );

            if (
              code !== 0
            ) {
              reject(
                new Error(
                  [
                    `Codex CLI exited with code ${code}.`,
                    stderr.trim(),
                    stdout.trim()
                  ]
                    .filter(
                      Boolean
                    )
                    .join(
                      "\n"
                    )
                )
              );

              return;
            }

            resolve();
          }
        );

        if (stdin) {
          child.stdin.write(
            stdin
          );
        }

        child.stdin.end();
      }
    );
  }
}

const businessSpecSchema = {
  type:
    "object",
  additionalProperties:
    false,
  required: [
    "applicationId",
    "name",
    "packageName",
    "actors",
    "rules",
    "capabilities",
    "surfaces",
    "workflows"
  ],
  properties: {
    applicationId: {
      type:
        "string"
    },
    name: {
      type:
        "string"
    },
    packageName: {
      type:
        "string"
    },
    actors: {
      type:
        "array",
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "id",
          "label"
        ],
        properties: {
          id: {
            type:
              "string"
          },
          label: {
            type:
              "string"
          }
        }
      }
    },
    rules: {
      type:
        "array",
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "id",
          "description"
        ],
        properties: {
          id: {
            type:
              "string"
          },
          description: {
            type:
              "string"
          }
        }
      }
    },
    capabilities: {
      type:
        "array",
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "id",
          "description",
          "required"
        ],
        properties: {
          id: {
            type:
              "string"
          },
          description: {
            type:
              "string"
          },
          required: {
            type:
              "boolean"
          }
        }
      }
    },
    surfaces: {
      type:
        "array",
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "kind",
          "purpose",
          "blocking"
        ],
        properties: {
          kind: {
            type:
              "string"
          },
          purpose: {
            type:
              "string"
          },
          blocking: {
            type:
              "boolean"
          }
        }
      }
    },
    workflows: {
      type:
        "array",
      minItems:
        1,
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "id",
          "description",
          "actors",
          "rules",
          "effects"
        ],
        properties: {
          id: {
            type:
              "string"
          },
          description: {
            type:
              "string"
          },
          actors: {
            type:
              "array",
            items: {
              type:
                "string"
            }
          },
          rules: {
            type:
              "array",
            items: {
              type:
                "string"
            }
          },
          effects: {
            type:
              "array",
            items: {
              type:
                "string"
            }
          }
        }
      }
    }
  }
} as const;

const buildPlanSchema = {
  type:
    "object",
  additionalProperties:
    false,
  required: [
    "packageName",
    "workflowIds",
    "workflowVersions",
    "componentIds",
    "surfaceKinds",
    "capabilities",
    "files",
    "tests"
  ],
  properties: {
    packageName: {
      type:
        "string"
    },
    workflowIds: {
      type:
        "array",
      items: {
        type:
          "string"
      }
    },
    workflowVersions: {
      type:
        "object",
      additionalProperties: {
        type:
          "string"
      }
    },
    componentIds: {
      type:
        "array",
      items: {
        type:
          "string"
      }
    },
    surfaceKinds: {
      type:
        "array",
      items: {
        type:
          "string"
      }
    },
    capabilities: {
      type:
        "array",
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "id",
          "source"
        ],
        properties: {
          id: {
            type:
              "string"
          },
          source: {
            type:
              "string",
            enum: [
              "existing",
              "mcp",
              "install",
              "generate"
            ]
          },
          detail: {
            type:
              "string"
          }
        }
      }
    },
    files: {
      type:
        "array",
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "path",
          "purpose"
        ],
        properties: {
          path: {
            type:
              "string"
          },
          purpose: {
            type:
              "string"
          }
        }
      }
    },
    tests: {
      type:
        "array",
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "id",
          "description",
          "kind"
        ],
        properties: {
          id: {
            type:
              "string"
          },
          description: {
            type:
              "string"
          },
          kind: {
            type:
              "string",
            enum: [
              "business",
              "durability",
              "security"
            ]
          }
        }
      }
    }
  }
} as const;

const artifactsSchema = {
  type:
    "object",
  additionalProperties:
    false,
  required: [
    "artifacts"
  ],
  properties: {
    artifacts: {
      type:
        "array",
      minItems:
        1,
      items: {
        type:
          "object",
        additionalProperties:
          false,
        required: [
          "path",
          "content"
        ],
        properties: {
          path: {
            type:
              "string"
          },
          content: {
            type:
              "string"
          }
        }
      }
    }
  }
} as const;

function json(
  value:
    unknown
) {
  return JSON.stringify(
    value,
    null,
    2
  );
}

export class CodexRequirementAnalyst
  implements RequirementAnalyst {
  constructor(
    private readonly client:
      CodexCliClient,
    private readonly projectRoot:
      string
  ) {}

  async analyze(
    request:
      RequirementRequest,
    inventory:
      ProjectInventory
  ): Promise<
    BusinessSpec
  > {
    return this.client
      .runStructured<
        BusinessSpec
      >({
        cwd:
          this.projectRoot,
        schema:
          businessSpecSchema,
        prompt:
          `You are the RequirementAnalyst phase of UAIR Builder.

Convert the user's business requirement into a stable BusinessSpec JSON.

Rules:
- Prefer stable semantic IDs such as "hr.leave.request"; never derive durable IDs from function names.
- Prefer npm/MCP/existing capabilities over inventing framework primitives.
- Surface kinds are semantic UI contracts.
- Package name should respect request.packageName when supplied.
- Do not write files or code in this phase.
- Return only data matching the output schema.

Requirement:
${json(request)}

Existing project inventory:
${json(inventory)}
`
      });
  }
}

export class CodexSolutionArchitect
  implements SolutionArchitect {
  constructor(
    private readonly client:
      CodexCliClient,
    private readonly projectRoot:
      string
  ) {}

  async plan(
    spec:
      BusinessSpec,
    inventory:
      ProjectInventory
  ): Promise<
    BuildPlan
  > {
    return this.client
      .runStructured<
        BuildPlan
      >({
        cwd:
          this.projectRoot,
        schema:
          buildPlanSchema,
        prompt:
          `You are the SolutionArchitect phase of UAIR Builder.

Produce the minimal BuildPlan for the supplied BusinessSpec.

Hard constraints:
- Reuse existing capabilities when IDs match.
- Missing capability source may be mcp/install/generate, but do not invent a new package manager.
- Existing durable Workflow IDs MUST advance version instead of overwriting the existing version.
- For numeric existing Workflow versions, target the next integer.
- Use stable semantic Workflow/Component/Surface IDs, not variable names.
- Keep the plan minimal.
- Include business, durability, and security tests where relevant.
- Return only data matching the output schema.

BusinessSpec:
${json(spec)}

Existing inventory:
${json(inventory)}
`
      });
  }
}

export class CodexArtifactImplementer
  implements ArtifactImplementer {
  constructor(
    private readonly client:
      CodexCliClient,
    private readonly projectRoot:
      string
  ) {}

  async implement(
    spec:
      BusinessSpec,
    plan:
      BuildPlan
  ): Promise<
    GeneratedArtifact[]
  > {
    const result =
      await this.client
        .runStructured<{
          artifacts:
            GeneratedArtifact[];
        }>({
          cwd:
            this.projectRoot,
          schema:
            artifactsSchema,
          prompt:
            `You are the coding implementation phase of UAIR Builder.

Generate the complete candidate package as an array of file artifacts.

UAIR constraints:
- Use @uair/core Workflow/Component primitives and @uair/ui Surface primitives already present in this repository.
- Durable Workflow identity comes ONLY from explicit workflow({ id, version }).
- Generate the exact workflow versions from BuildPlan.workflowVersions.
- Do not overwrite old deployed versions conceptually; candidate files represent the new version.
- Do not add a custom package manager. Use package.json/npm.
- Prefer existing project APIs and package patterns. Inspect the repository as needed.
- Do not emit prose. Return only structured artifacts.
- Every path must be relative and remain inside the generated package.
- Include package.json, TypeScript source, exports, tsconfig and executable tests needed by the BuildPlan.
- Avoid placeholders/TODOs.
- Keep code production-oriented but minimal.

BusinessSpec:
${json(spec)}

BuildPlan:
${json(plan)}
`
        });

    return result.artifacts;
  }
}
