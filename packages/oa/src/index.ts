import {
  component,
  workflow
} from "@uair/core";
import {
  ui
} from "@uair/ui";

import {
  interaction
} from "@uair/interaction";
import {
  capability,
  CapabilitySet
} from "@uair/package";
import type {
  Principal
} from "@uair/security";
import type {
  Component
} from "@uair/core";

export type LeaveRequest = {
  applicantId: string;
  days: number;
  reason: string;
};

export type LeaveDecision = {
  approved: boolean;
  comment?: string;
};

const persistLeave =
  component<
    LeaveRequest,
    {
      id: string;
      status: "saved";
    }
  >(
    "oa.persistLeave",
    async request => ({
      id:
        `leave:${request.applicantId}:${request.days}`,
      status: "saved"
    })
  );

export function createOaPackage(
  deps: {
    requirePermission:
      Component<
        {
          principal:
            Principal;
          permission:
            string;
        },
        true
      >;
  }
) {
  const leaveForm =
    ui<
      LeaveRequest,
      LeaveRequest
    >(
      "OaLeaveForm",
      {
        version: "1"
      }
    );

  const managerApproval =
    ui<
      {
        request:
          LeaveRequest;
      },
      LeaveDecision
    >(
      "OaManagerApproval",
      {
        version: "1"
      }
    );

  const leaveWorkflow =
    workflow(
      "oa.leave",
      async (
        input: {
          principal:
            Principal;
          request:
            LeaveRequest;
        }
      ) => {
        await deps
          .requirePermission({
            principal:
              input.principal,
            permission:
              "oa.leave.submit"
          });

        const edited =
          await leaveForm(
            input.request
          );

        const decision =
          await managerApproval({
            request: edited
          });

        if (
          !decision.approved
        ) {
          return {
            status:
              "rejected" as const,
            request: edited,
            decision
          };
        }

        const saved =
          await persistLeave(
            edited
          );

        return {
          status:
            "approved" as const,
          request: edited,
          decision,
          saved
        };
      }
    );

  const capabilities =
    new CapabilitySet([
      capability({
        id:
          "oa.leave.persist",
        kind: "tool",
        description:
          "Persist an approved leave request",
        invoke:
          persistLeave as any,
        metadata: {
          permission:
            "oa.leave.persist"
        }
      }),
      capability({
        id:
          "oa.leave.form",
        kind: "ui",
        description:
          "Collect or edit a leave request",
        metadata: {
          permission:
            "oa.leave.submit"
        }
      }),
      capability({
        id:
          "oa.leave.managerApproval",
        kind: "ui",
        description:
          "Manager approval UI for leave request",
        metadata: {
          permission:
            "oa.leave.approve"
        }
      }),
      capability({
        id:
          "oa.leave.workflow",
        kind: "workflow",
        description:
          "Fixed leave approval workflow",
        metadata: {
          permission:
            "oa.leave.submit"
        }
      })
    ]);

  return {
    leaveForm,
    managerApproval,
    persistLeave,
    leaveWorkflow,
    capabilities
  };
}


export type InteractiveOaDirectory = {
  /**
   * Organization lookups are durable Components, not naked async calls.
   * Their result/TTL policy decides when a changed org chart may affect
   * a replayed Workflow.
   */
  managerOf:
    Component<
      {
        employeeId:
          string;
      },
      string
    >;

  directorOf?:
    Component<
      {
        employeeId:
          string;
      },
      string
    >;
};

/**
 * Production-style OA example:
 *
 * - Runtime remains centralized.
 * - The employee-facing form is ordinary UI.
 * - Human approvals are durable Interactions assigned to opaque user IDs.
 * - Organization lookup stays outside Runtime Core.
 */
export function createInteractiveOaPackage(
  deps: {
    requirePermission:
      Component<
        {
          principal:
            Principal;
          permission:
            string;
        },
        true
      >;

    directory:
      InteractiveOaDirectory;
  }
) {
  const leaveForm =
    ui<
      LeaveRequest,
      LeaveRequest
    >(
      "OaLeaveForm",
      {
        version:
          "1"
      }
    );

  const managerApproval =
    interaction<
      {
        request:
          LeaveRequest;
      },
      LeaveDecision
    >(
      "hr.leave.manager-approval"
    );

  const directorApproval =
    interaction<
      {
        request:
          LeaveRequest;
      },
      LeaveDecision
    >(
      "hr.leave.director-approval"
    );

  const leaveWorkflow =
    workflow(
      "oa.leave.interactive",
      {
        version:
          "1"
      },
      async (
        input: {
          principal:
            Principal;
          request:
            LeaveRequest;
        }
      ) => {
        await deps
          .requirePermission({
            principal:
              input.principal,
            permission:
              "oa.leave.submit"
          });

        const edited =
          await leaveForm(
            input.request
          );

        const managerId =
          await deps
            .directory
            .managerOf({
              employeeId:
                edited
                  .applicantId
            });

        const managerDecision =
          await managerApproval({
            assignee:
              managerId,
            title:
              "请假审批",
            data: {
              request:
                edited
            },
            metadata: {
              applicantId:
                edited
                  .applicantId,
              stage:
                "manager"
            }
          });

        if (
          !managerDecision
            .approved
        ) {
          return {
            status:
              "rejected" as const,
            request:
              edited,
            decision:
              managerDecision,
            stage:
              "manager" as const
          };
        }

        if (
          edited.days > 3 &&
          deps.directory
            .directorOf
        ) {
          const directorId =
            await deps
              .directory
              .directorOf({
                employeeId:
                  edited
                    .applicantId
              });

          const directorDecision =
            await directorApproval({
              assignee:
                directorId,
              title:
                "长假追加审批",
              data: {
                request:
                  edited
              },
              metadata: {
                applicantId:
                  edited
                    .applicantId,
                stage:
                  "director"
              }
            });

          if (
            !directorDecision
              .approved
          ) {
            return {
              status:
                "rejected" as const,
              request:
                edited,
              decision:
                directorDecision,
              stage:
                "director" as const
            };
          }
        }

        const saved =
          await persistLeave(
            edited
          );

        return {
          status:
            "approved" as const,
          request:
            edited,
          saved
        };
      }
    );

  return {
    leaveForm,
    managerApproval,
    directorApproval,
    persistLeave,
    leaveWorkflow
  };
}
