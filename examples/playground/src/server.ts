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

import { RuntimeEngine, run } from "@uair/core";
import { JsonFileStorage, resolveSuspension } from "@uair/core/runtime";
import {
  listPendingUi,
  uiResultEvent
} from "@uair/ui";
import {
  playgroundWorkflow
} from "./workflow.js";
import {
  buildExecutionTree
} from "./inspector.js";

const storage =
  new JsonFileStorage(
    ".uair/playground"
  );

const engine =
  new RuntimeEngine(
    storage,
    [
      playgroundWorkflow
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
    const chunk of request
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

function json(
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
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

async function snapshot(
  executionId?: string
) {
  const executions =
    await storage.listExecutions();

  const target =
    executionId
      ? executions.find(
          item =>
            item.id ===
            executionId
        )
      : executions[
          executions.length - 1
        ];

  const pendingUi =
    await listPendingUi(
      storage
    );

  return {
    execution:
      target ?? null,
    tree:
      target
        ? buildExecutionTree(
            target
          )
        : null,
    pendingUi:
      target
        ? pendingUi.filter(
            item =>
              item.executionId ===
              target.id
          )
        : [],
    executions:
      executions.map(
        item => ({
          id: item.id,
          workflow:
            item.workflow,
          status:
            item.status,
          result:
            item.result
        })
      )
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
              playgroundWorkflow,
              {
                user:
                  String(
                    body?.user ??
                    "demo-user"
                  ),
                task:
                  String(
                    body?.task ??
                    "Review this expense report"
                  )
              },
              storage
            );

          json(
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
            "/api/ui/resolve"
        ) {
          const body =
            await readJson(
              request
            );

          await engine.emit(
            uiResultEvent({
              eventId:
                String(
                  body.eventId ??
                  `ui:${Date.now()}`
                ),
              suspensionId:
                String(
                  body.suspensionId
                ),
              value:
                body.value
            })
          );

          const indexed =
            await storage
              .listExecutions();

          const target =
            indexed.find(
              item =>
                item.history.some(
                  entry =>
                    entry.kind ===
                      "suspension_created" &&
                    entry.suspensionId ===
                      body.suspensionId
                )
            );

          json(
            response,
            200,
            await snapshot(
              target?.id
            )
          );

          return;
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/suspension/resolve"
        ) {
          const body =
            await readJson(
              request
            );

          const updated =
            await resolveSuspension(
              String(
                body.suspensionId
              ),
              body.value,
              storage,
              "manual"
            );

          const workflow =
            updated.workflow ===
              "playground.demo"
              ? playgroundWorkflow
              : null;

          if (!workflow) {
            throw new Error(
              `Workflow not registered: ${updated.workflow}`
            );
          }

          await engine.recover();

          json(
            response,
            200,
            await snapshot(
              updated.id
            )
          );

          return;
        }

        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/fork"
        ) {
          const body =
            await readJson(
              request
            );

          const source =
            await storage.loadExecution(
              String(
                body.executionId
              )
            );

          if (!source) {
            throw new Error(
              "Source execution not found"
            );
          }

          // Fork deliberately starts a fresh execution from the original
          // workflow input. History is not copied: this is a reproducible
          // rerun, not mutation of durable truth.
          const forked =
            await run(
              playgroundWorkflow,
              body.input ??
                source.input,
              storage
            );

          json(
            response,
            200,
            await snapshot(
              forked.id
            )
          );

          return;
        }

        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/state"
        ) {
          json(
            response,
            200,
            await snapshot(
              url.searchParams.get(
                "executionId"
              ) ??
              undefined
            )
          );

          return;
        }

        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/reset"
        ) {
          json(
            response,
            200,
            {
              ok: true,
              note:
                "Delete .uair/playground to clear persisted demo history."
            }
          );

          return;
        }

        let file =
          url.pathname === "/"
            ? "index.html"
            : url.pathname.slice(1);

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

        response.end(content);
      } catch (error: any) {
        json(
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
    8787
  );

server.listen(
  port,
  () => {
    console.log(
      `UAIR Playground: http://localhost:${port}`
    );
  }
);
