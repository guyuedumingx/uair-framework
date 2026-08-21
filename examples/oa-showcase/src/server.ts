import {
  createServer
} from "node:http";
import {
  readFile
} from "node:fs/promises";
import {
  resolve,
  join,
  extname
} from "node:path";
import {
  fileURLToPath
} from "node:url";

import {
  RuntimeEngine,
  run
} from "@uair/core";

import {
  JsonFileStorage
} from "@uair/core/runtime";

import {
  listPendingUi,
  uiResultEvent
} from "@uair/ui";

import {
  expenseWorkflow
} from "./workflow.js";

const bootId =
  `boot-${Date.now().toString(36)}`;

const bootedAt =
  Date.now();

const storage =
  new JsonFileStorage(
    ".uair/oa-showcase"
  );

const engine =
  new RuntimeEngine(
    storage,
    [
      expenseWorkflow
    ]
  );

const here =
  fileURLToPath(
    new URL(
      ".",
      import.meta.url
    )
  );

const publicDir =
  resolve(
    here,
    "../public"
  );

async function readJson(
  request:
    import("node:http")
      .IncomingMessage
) {
  const chunks:
    Buffer[] = [];

  for await (
    const chunk
    of request
  ) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  if (
    chunks.length === 0
  ) {
    return undefined;
  }

  return JSON.parse(
    Buffer.concat(chunks)
      .toString("utf8")
  );
}

function writeJson(
  response:
    import("node:http")
      .ServerResponse,
  status: number,
  value: unknown
) {
  response.writeHead(
    status,
    {
      "content-type":
        "application/json; charset=utf-8"
    }
  );

  response.end(
    JSON.stringify(
      value,
      null,
      2
    )
  );
}

function mime(
  path: string
) {
  switch (
    extname(path)
  ) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "text/plain; charset=utf-8";
  }
}

function projectTimeline(
  execution: any
) {
  if (!execution) {
    return [];
  }

  return execution.history
    .filter(
      (entry: any) =>
        entry.kind ===
          "effect_completed" ||
        entry.kind ===
          "suspension_created" ||
        entry.kind ===
          "suspension_resolved"
    )
    .map(
      (entry: any) => {
        if (
          entry.kind ===
            "effect_completed"
        ) {
          return {
            type:
              "effect",
            component:
              entry.component,
            status:
              "completed",
            durationMs:
              entry.startedAt
                ? entry.completedAt -
                  entry.startedAt
                : null,
            at:
              entry.completedAt,
            path:
              entry.path
          };
        }

        if (
          entry.kind ===
            "suspension_created"
        ) {
          const resolved =
            execution.history
              .find(
                (candidate: any) =>
                  candidate.kind ===
                    "suspension_resolved" &&
                  candidate
                    .suspensionId ===
                    entry.suspensionId
              );

          return {
            type:
              "ui",
            component:
              entry.component,
            status:
              resolved
                ? "completed"
                : "waiting",
            durationMs:
              resolved
                ? resolved.resolvedAt -
                  entry.createdAt
                : Date.now() -
                  entry.createdAt,
            at:
              entry.createdAt,
            path:
              entry.path
          };
        }

        return {
          type:
            "resume",
          component:
            "Human decision",
          status:
            "completed",
          durationMs:
            null,
          at:
            entry.resolvedAt
        };
      }
    );
}

async function snapshot(
  executionId?: string
) {
  const executions =
    await storage
      .listExecutions();

  const execution =
    executionId
      ? executions.find(
          item =>
            item.id ===
            executionId
        )
      : executions[
          executions.length - 1
        ];

  const pending =
    await listPendingUi(
      storage
    );

  const pendingUi =
    execution
      ? pending.find(
          item =>
            item.executionId ===
            execution.id
        )
      : undefined;

  return {
    execution:
      execution ?? null,
    timeline:
      projectTimeline(
        execution
      ),
    pendingUi:
      pendingUi ?? null,
    meta:
      execution
        ? {
            workflow:
              execution.workflow,
            version:
              execution
                .workflowVersion,
            deploymentId:
              execution
                .deploymentId ??
              "local-demo",
            fingerprint:
              execution
                .workflowFingerprint
                ?.slice(
                  0,
                  10
                ) ??
              "—",
            historyEvents:
              execution
                .history
                .length
          }
        : null
  };
}

const server =
  createServer(
    async (
      request,
      response
    ) => {
      try {
        const url =
          new URL(
            request.url ?? "/",
            "http://localhost"
          );

        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/start"
        ) {
          const body =
            await readJson(
              request
            );

          const execution =
            await run(
              expenseWorkflow,
              {
                applicant:
                  String(
                    body?.applicant ??
                    "王小宇"
                  ),
                department:
                  String(
                    body?.department ??
                    "产品与智能化部"
                  ),
                title:
                  String(
                    body?.title ??
                    "AI Agent 行业大会差旅"
                  ),
                amount:
                  Number(
                    body?.amount ??
                    6800
                  ),
                category:
                  String(
                    body?.category ??
                    "差旅费"
                  ),
                description:
                  String(
                    body?.description ??
                    "参加深圳 AI Agent 产业大会，与三家潜在合作方进行产品交流。"
                  )
              },
              storage
            );

          writeJson(
            response,
            200,
            await snapshot(
              execution.id
            )
          );

          return;
        }

        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/decision"
        ) {
          const body =
            await readJson(
              request
            );

          const executionId =
            String(
              body?.executionId ??
              ""
            );

          const state =
            await snapshot(
              executionId
            );

          if (
            !state.pendingUi
          ) {
            throw new Error(
              "No pending approval"
            );
          }

          await engine.emit(
            uiResultEvent({
              eventId:
                `approval:${Date.now()}`,
              suspensionId:
                state.pendingUi
                  .suspensionId,
              value: {
                approved:
                  Boolean(
                    body?.approved
                  ),
                comment:
                  String(
                    body?.comment ??
                    (
                      body?.approved
                        ? "同意，按制度报销。"
                        : "退回补充说明。"
                    )
                  )
              }
            })
          );

          writeJson(
            response,
            200,
            await snapshot(
              executionId
            )
          );

          return;
        }

        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/health"
        ) {
          writeJson(
            response,
            200,
            {
              online: true,
              bootId,
              bootedAt,
              uptimeMs:
                Date.now() -
                bootedAt
            }
          );

          return;
        }

        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/state"
        ) {
          writeJson(
            response,
            200,
            await snapshot(
              url.searchParams
                .get(
                  "executionId"
                ) ??
              undefined
            )
          );

          return;
        }

        const file =
          url.pathname === "/"
            ? "index.html"
            : url.pathname
                .slice(1);

        if (
          file.includes("..")
        ) {
          response.writeHead(400);
          response.end("Bad path");
          return;
        }

        const path =
          join(
            publicDir,
            file
          );

        const content =
          await readFile(path);

        response.writeHead(
          200,
          {
            "content-type":
              mime(path)
          }
        );

        response.end(
          content
        );
      } catch (
        error: any
      ) {
        writeJson(
          response,
          500,
          {
            error:
              error?.message ??
              String(error)
          }
        );
      }
    }
  );

const port =
  Number(
    process.env.PORT ??
      8788
  );

server.listen(
  port,
  () => {
    console.log(
      `UAIR OA Showcase: http://localhost:${port}`
    );
  }
);
