import assert from "node:assert/strict";

import {
  mkdtemp,
  rm
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

import {
  component,
  resume,
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage,
  resolveSuspension
} from "../packages/core/dist/runtime-api.js";

import {
  createRbac
} from "../packages/security/dist/index.js";

import {
  createInteractiveOaPackage
} from "../packages/oa/dist/index.js";

import {
  InteractionAuthorizationError,
  InteractionService
} from "../packages/interaction/dist/index.js";

import {
  buildProjectGraph
} from "../packages/builder/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-interaction-"
    )
  );

try {
  const storage =
    new JsonFileStorage(
      join(
        dir,
        "executions"
      )
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

  const oa =
    createInteractiveOaPackage({
      requirePermission:
        rbac
          .requirePermission,
      directory: {
        managerOf:
          component(
            "org.managerOf",
            async (
              input
            ) => {
              assert.equal(
                input.employeeId,
                "employee:alice"
              );

              return "user:manager-li";
            }
          ),

        directorOf:
          component(
            "org.directorOf",
            async () =>
              "user:director-wang"
          )
      }
    });

  const started =
    await run(
      oa.leaveWorkflow,
      {
        principal: {
          id:
            "employee:alice",
          roles: [
            "employee"
          ]
        },
        request: {
          applicantId:
            "employee:alice",
          days:
            5,
          reason:
            "家庭事务"
        }
      },
      storage
    );

  assert.equal(
    started.status,
    "suspended",
    "employee-facing form should suspend the centralized Workflow"
  );

  const initial =
    await storage
      .listSuspensions();

  const form =
    initial.find(
      item =>
        item.suspension
          .spec?.type ===
          "ui"
    );

  assert.ok(form);

  await resolveSuspension(
    form.suspension
      .suspensionId,
    {
      applicantId:
        "employee:alice",
      days:
        5,
      reason:
        "家庭事务"
    },
    storage,
    "manual"
  );

  const waitingManager =
    await resume(
      oa.leaveWorkflow,
      started.id,
      storage
    );

  assert.equal(
    waitingManager.status,
    "suspended"
  );

  const directService =
    new InteractionService(
      storage
    );

  const employeeInbox =
    await directService
      .listPending(
        "employee:alice"
      );

  assert.equal(
    employeeInbox.length,
    0,
    "employee must not see manager's approval task"
  );

  const managerInbox =
    await directService
      .listPending(
        "user:manager-li"
      );

  assert.equal(
    managerInbox.length,
    1
  );

  assert.equal(
    managerInbox[0]
      .kind,
    "hr.leave.manager-approval"
  );

  assert.equal(
    managerInbox[0]
      .assignee,
    "user:manager-li"
  );

  await assert.rejects(
    () =>
      directService
        .getForActor({
          interactionId:
            managerInbox[0].id,
          actor:
            "employee:alice"
        }),
    InteractionAuthorizationError,
    "direct lookup must not bypass Inbox authorization"
  );

  await assert.rejects(
    () =>
      directService.resolve({
        interactionId:
          managerInbox[0]
            .id,
        actor:
          "employee:alice",
        value: {
          approved:
            true
        }
      }),
    InteractionAuthorizationError
  );

  /**
   * Delegation/acting-manager policy stays outside Core.
   * The host can allow a delegate without changing the stored assignee.
   */
  const delegated =
    new InteractionService(
      storage,
      (
        {
          actor,
          assignee
        }
      ) =>
        actor ===
          assignee ||
        (
          actor ===
            "user:assistant-chen" &&
          assignee ===
            "user:manager-li"
        )
    );

  const delegatedInbox =
    await delegated
      .listPending(
        "user:assistant-chen"
      );

  assert.equal(
    delegatedInbox.length,
    1,
    "delegation is host policy, not a Core identity feature"
  );

  /**
   * Two devices can race on the same approval. Optimistic execution
   * revision guarantees first durable resolution wins; the second call
   * reloads the winner instead of overwriting it.
   */
  const concurrent =
    await Promise.all([
      delegated.resolve({
        interactionId:
          managerInbox[0]
            .id,
        actor:
          "user:assistant-chen",
        value: {
          approved:
            true,
          comment:
            "手机端"
        }
      }),
      delegated.resolve({
        interactionId:
          managerInbox[0]
            .id,
        actor:
          "user:assistant-chen",
        value: {
          approved:
            true,
          comment:
            "电脑端"
        }
      })
    ]);

  const afterManagerResolve =
    concurrent[0];

  const managerResolutions =
    afterManagerResolve
      .history
      .filter(
        entry =>
          entry.kind ===
          "suspension_resolved" &&
        entry.suspensionId ===
          managerInbox[0].id
      );

  assert.equal(
    managerResolutions.length,
    1,
    "concurrent approval must have one durable winner"
  );

  assert.equal(
    managerResolutions[0]
      .resolvedBy,
    "user:assistant-chen",
    "human actor must be preserved in durable audit history"
  );

  /**
   * Later network retry remains idempotent even after suspension index
   * removal.
   */
  const duplicate =
    await delegated.resolve({
      interactionId:
        managerInbox[0]
          .id,
      actor:
        "user:assistant-chen",
      value:
        managerResolutions[0]
          .value
    });

  assert.equal(
    duplicate
      .history
      .filter(
        entry =>
          entry.kind ===
          "suspension_resolved" &&
        entry.suspensionId ===
          managerInbox[0].id
      )
      .length,
    1
  );

  const waitingDirector =
    await resume(
      oa.leaveWorkflow,
      started.id,
      storage
    );

  assert.equal(
    waitingDirector.status,
    "suspended"
  );

  const directorInbox =
    await directService
      .listPending(
        "user:director-wang"
      );

  assert.equal(
    directorInbox.length,
    1
  );

  assert.equal(
    directorInbox[0]
      .kind,
    "hr.leave.director-approval"
  );

  await directService.resolve({
    interactionId:
      directorInbox[0].id,
    actor:
      "user:director-wang",
    value: {
      approved:
        true
    }
  });

  const directorResolvedExecution =
    await storage.loadExecution(
      started.id
    );

  assert.equal(
    directorResolvedExecution
      ?.history
      .find(
        entry =>
          entry.kind ===
            "suspension_resolved" &&
          entry.suspensionId ===
            directorInbox[0].id
      )
      ?.resolvedBy,
    "user:director-wang"
  );

  const completed =
    await resume(
      oa.leaveWorkflow,
      started.id,
      storage
    );

  assert.equal(
    completed.status,
    "completed"
  );

  assert.equal(
    completed.result
      .status,
    "approved"
  );

  assert.equal(
    (
      await directService
        .listPending(
          "user:manager-li"
        )
    ).length,
    0
  );

  assert.equal(
    (
      await directService
        .listPending(
          "user:director-wang"
        )
    ).length,
    0
  );


  const graph =
    await buildProjectGraph(
      join(
        process.cwd(),
        "packages/oa"
      )
    );

  const managerSurface =
    graph.nodes.find(
      node =>
        node.key ===
        "surface:hr.leave.manager-approval"
    );

  assert.ok(
    managerSurface,
    "Builder ProjectGraph must see Interaction as a Surface contract"
  );

  assert.equal(
    managerSurface.contract
      ?.data
      ?.kind,
    "object"
  );

  assert.equal(
    managerSurface.contract
      ?.action
      ?.kind,
    "object"
  );

  assert.equal(
    graph.edges.some(
      edge =>
        edge.from ===
          "workflow:oa.leave.interactive" &&
        edge.to ===
          "surface:hr.leave.manager-approval" &&
        edge.kind ===
          "uses"
    ),
    true,
    "Workflow → Interaction dependency must remain visible to Builder"
  );

  console.log(
    JSON.stringify(
      {
        runtime:
          "centralized",
        employeeClient:
          "form UI",
        managerInbox:
          managerInbox.map(
            item => ({
              id:
                item.id,
              kind:
                item.kind,
              assignee:
                item.assignee
            })
          ),
        delegatedActor:
          "user:assistant-chen",
        directorInbox:
          directorInbox.map(
            item => ({
              kind:
                item.kind,
              assignee:
                item.assignee
            })
          ),
        finalStatus:
          completed.status,
        finalResult:
          completed.result,
        builderGraph: {
          managerSurface:
            managerSurface.id,
          dataContract:
            managerSurface.contract
              ?.data
              ?.kind,
          actionContract:
            managerSurface.contract
              ?.action
              ?.kind
        }
      },
      null,
      2
    )
  );

  console.log(
    "UAIR human Interaction / Inbox end-to-end verification: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
