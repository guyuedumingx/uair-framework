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
  conversationalAgent
} from "./workflow.js";

const storage =
  new JsonFileStorage(
    ".uair/conversational-agent"
  );

const engine =
  new RuntimeEngine(
    storage,
    [
      conversationalAgent
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

  return chunks.length
    ? JSON.parse(
        Buffer.concat(
          chunks
        ).toString(
          "utf8"
        )
      )
    : undefined;
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
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
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
          executions.length -
          1
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

  const suspension =
    execution
      ?.history
      .filter(
        (entry: any) =>
          entry.kind ===
            "suspension_created"
      )
      .at(-1) as any;

  const surface =
    suspension
      ?.input;

  const data =
    surface
      ?.data ??
    {};

  const history =
    execution
      ?.history ??
    [];

  const timeline =
    history
      .filter(
        (entry: any) =>
          [
            "component_started",
            "component_completed",
            "suspension_created",
            "suspension_resolved"
          ].includes(
            entry.kind
          )
      )
      .slice(-12)
      .map(
        (entry: any) => ({
          kind:
            entry.kind,
          component:
            entry.component,
          suspensionId:
            entry.suspensionId,
          path:
            entry.path,
          at:
            entry.createdAt ??
            entry.resolvedAt ??
            entry.completedAt ??
            entry.startedAt
        })
      );

  return {
    execution:
      execution ?? null,
    pendingUi:
      pendingUi ?? null,
    surface:
      surface ?? null,
    turn:
      data.turn ??
      0,
    view:
      data.view ??
      null,
    display:
      data.display ??
      null,
    controlFlow:
      data.controlFlow ??
      null,
    transcript:
      data.transcript ??
      [],
    timeline,
    runtime: execution
      ? {
          status:
            execution.status,
          workflow:
            execution.workflow,
          workflowVersion:
            execution.workflowVersion,
          revision:
            execution.revision,
          historyEvents:
            history.length,
          waiting:
            Boolean(
              pendingUi
            )
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
            request.url ??
              "/",
            "http://localhost"
          );

        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/start"
        ) {
          const execution =
            await run(
              conversationalAgent,
              undefined,
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
            "/api/action"
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
              "Conversation is not waiting for input"
            );
          }

          await engine.emit(
            uiResultEvent({
              eventId:
                `turn:${Date.now()}`,
              suspensionId:
                state.pendingUi
                  .suspensionId,
              value:
                body.action
            })
          );

          json(
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
            "/api/state"
        ) {
          json(
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
          url.pathname ===
            "/"
            ? "index.html"
            : url.pathname
                .slice(1);

        const path =
          join(
            publicDir,
            file
          );

        response.writeHead(
          200,
          {
            "content-type":
              mime(path)
          }
        );

        response.end(
          await readFile(path)
        );
      } catch (
        error: any
      ) {
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
      8789
  );

server.listen(
  port,
  () => {
    console.log(
      `UAIR Conversational Agent: http://localhost:${port}`
    );
  }
);
