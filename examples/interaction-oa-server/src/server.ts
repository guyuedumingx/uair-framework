import {
  createServer
} from "node:http";

import {
  component,
  resume,
  run
} from "@uair/core";

import {
  JsonFileStorage,
  resolveSuspension
} from "@uair/core/runtime";

import {
  createRbac
} from "@uair/security";

import {
  createInteractiveOaPackage
} from "@uair/oa";

import {
  InteractionService
} from "@uair/interaction";

const storage =
  new JsonFileStorage(
    ".uair/runtime"
  );

const rbac =
  createRbac([
    {
      role:
        "employee",
      allow: [
        "oa.leave.submit"
      ]
    }
  ]);

const currentOrg = {
  manager:
    "user:manager-li",
  director:
    "user:director-wang"
};

const oa =
  createInteractiveOaPackage({
    requirePermission:
      rbac.requirePermission,

    directory: {
      managerOf:
        component(
          "org.managerOf",
          {
            resultValidForMs:
              5 * 60 * 1000
          },
          async () =>
            currentOrg.manager
        ),

      directorOf:
        component(
          "org.directorOf",
          {
            resultValidForMs:
              5 * 60 * 1000
          },
          async () =>
            currentOrg.director
        )
    }
  });

/**
 * Host-level authorization policy.
 *
 * Core does not know users/roles/delegation. A real enterprise host
 * would ask its IAM/HR directory here.
 */
const interactions =
  new InteractionService(
    storage,
    (
      {
        actor,
        assignee
      }
    ) =>
      actor ===
        assignee
  );

async function body(
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
      Buffer.isBuffer(
        chunk
      )
        ? chunk
        : Buffer.from(
            chunk
          )
    );
  }

  if (
    chunks.length === 0
  ) {
    return {};
  }

  return JSON.parse(
    Buffer.concat(
      chunks
    ).toString(
      "utf8"
    )
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

        /**
         * Employee submits from Web/App/WeCom.
         * The central Runtime creates one durable execution.
         */
        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/leave"
        ) {
          const input =
            await body(
              request
            );

          const employeeId =
            String(
              input.employeeId
            );

          const requestValue = {
            applicantId:
              employeeId,
            days:
              Number(
                input.days
              ),
            reason:
              String(
                input.reason ??
                ""
              )
          };

          const execution =
            await run(
              oa.leaveWorkflow,
              {
                principal: {
                  id:
                    employeeId,
                  roles: [
                    "employee"
                  ]
                },
                request:
                  requestValue
              },
              storage
            );

          /**
           * This HTTP endpoint itself is the employee's fixed leave form,
           * so resolve the initial generic OaLeaveForm suspension with the
           * submitted payload and continue until the manager interaction.
           */
          const suspensions =
            await storage
              .listSuspensions();

          const form =
            suspensions.find(
              item =>
                item.executionId ===
                  execution.id &&
                (
                  item.suspension
                    .spec as any
                )?.type ===
                  "ui"
            );

          if (form) {
            await resolveSuspension(
              form.suspension
                .suspensionId,
              requestValue,
              storage
            );

            await resume(
              oa.leaveWorkflow,
              execution.id,
              storage
            );
          }

          const latest =
            await storage
              .loadExecution(
                execution.id
              );

          json(
            response,
            201,
            {
              executionId:
                execution.id,
              status:
                latest?.status
            }
          );

          return;
        }

        /**
         * Any client can render this list:
         * company Web Inbox, native App, WeCom, DingTalk, etc.
         */
        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/inbox"
        ) {
          const actor =
            String(
              url.searchParams
                .get(
                  "actor"
                ) ??
              ""
            );

          json(
            response,
            200,
            {
              actor,
              items:
                await interactions
                  .listPending(
                    actor
                  )
            }
          );

          return;
        }

        const resolveMatch =
          url.pathname.match(
            /^\/api\/interactions\/([^/]+)\/resolve$/
          );

        if (
          request.method ===
            "POST" &&
          resolveMatch
        ) {
          const input =
            await body(
              request
            );

          const interactionId =
            decodeURIComponent(
              resolveMatch[1]
            );

          const pending =
            await interactions
              .getForActor({
                interactionId,
                actor:
                  String(
                    input.actor
                  )
              });

          if (!pending) {
            throw new Error(
              `Interaction not found: ${interactionId}`
            );
          }

          await interactions
            .resolve({
              interactionId,
              actor:
                String(
                  input.actor
                ),
              value:
                input.value
            });

          const execution =
            await resume(
              oa.leaveWorkflow,
              pending.executionId,
              storage
            );

          json(
            response,
            200,
            {
              executionId:
                execution.id,
              status:
                execution.status
            }
          );

          return;
        }

        const executionMatch =
          url.pathname.match(
            /^\/api\/executions\/([^/]+)$/
          );

        if (
          request.method ===
            "GET" &&
          executionMatch
        ) {
          const execution =
            await storage
              .loadExecution(
                decodeURIComponent(
                  executionMatch[1]
                )
              );

          json(
            response,
            execution
              ? 200
              : 404,
            execution ??
              {
                error:
                  "not_found"
              }
          );

          return;
        }

        json(
          response,
          404,
          {
            error:
              "not_found"
          }
        );
      } catch (
        error: any
      ) {
        json(
          response,
          400,
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
      8791
  );

server.listen(
  port,
  () => {
    console.log(
      `UAIR centralized OA interaction demo: http://localhost:${port}`
    );
  }
);
