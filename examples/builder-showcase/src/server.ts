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
  run
} from "@uair/core";
import {
  JsonFileStorage
} from "@uair/core/runtime";

import {
  createBuilderWorkflow,
  createProjectAwareBuilderDefaults
} from "@uair/builder";

const storage =
  new JsonFileStorage(
    ".uair/builder-showcase"
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

const fixtureDir =
  resolve(
    here,
    "../fixture"
  );

const runtimeStorage =
  new JsonFileStorage(
    ".uair/builder-showcase-runtime"
  );

async function ensureRuntimeFixture() {
  const existing =
    await runtimeStorage
      .listExecutions();

  if (
    existing.some(
      item =>
        item.workflow ===
        "hr.leave.request"
    )
  ) {
    return;
  }

  await runtimeStorage
    .saveExecution({
      id:
        "leave-suspended-v2",
      workflow:
        "hr.leave.request",
      workflowVersion:
        "2",
      deploymentId:
        "deploy-leave-v2",
      input: {
        employeeId:
          "E1001",
        days: 5
      },
      status:
        "suspended",
      history: [
        {
          kind:
            "suspension_created",
          path:
            "0",
          component:
            "Surface",
          effectId:
            "effect-manager",
          generation:
            0,
          suspensionId:
            "manager-approval-1",
          createdAt:
            Date.now(),
          input: {
            kind:
              "hr.leave.manager-approval",
            data: {
              input: {
                employeeId:
                  "E1001",
                days: 5,
                reason:
                  "家庭安排"
              },
              balance: {
                remaining: 12
              }
            }
          },
          spec: {
            type:
              "ui"
          }
        }
      ]
    });

  await runtimeStorage
    .saveExecution({
      id:
        "leave-running-v2",
      workflow:
        "hr.leave.request",
      workflowVersion:
        "2",
      deploymentId:
        "deploy-leave-v2",
      input: {
        employeeId:
          "E1002",
        days: 2
      },
      status:
        "running",
      history: []
    });

  await runtimeStorage
    .saveExecution({
      id:
        "leave-completed-v1",
      workflow:
        "hr.leave.request",
      workflowVersion:
        "1",
      deploymentId:
        "deploy-leave-v1",
      input: {
        employeeId:
          "E0999",
        days: 1
      },
      status:
        "completed",
      history: [],
      result: {
        approved:
          true
      }
    });
}

await ensureRuntimeFixture();

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
    default:
      return "text/plain; charset=utf-8";
  }
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
            "/api/build"
        ) {
          const body =
            await readJson(
              request
            );

          const defaults =
            createProjectAwareBuilderDefaults(
              fixtureDir,
              runtimeStorage
            );

          const builder =
            createBuilderWorkflow(
              defaults
            );

          const execution =
            await run(
              builder,
              {
                description:
                  String(
                    body?.description ??
                    "修改现有请假系统：超过2天就要追加部门负责人审批，余额不足不能提交，审批后写入考勤并审计。"
                  ),
                companyScope:
                  String(
                    body?.companyScope ??
                    "acme"
                  )
              },
              storage
            );

          writeJson(
            response,
            200,
            {
              executionId:
                execution.id,
              result:
                execution.result
            }
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
      8790
  );

server.listen(
  port,
  () => {
    console.log(
      `UAIR Builder Showcase: http://localhost:${port}`
    );
  }
);
