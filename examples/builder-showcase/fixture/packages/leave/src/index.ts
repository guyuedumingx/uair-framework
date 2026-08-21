import {
  workflow,
  component
} from "@uair/core";

import {
  surface
} from "@uair/ui";

export const checkBalance =
  component({
    id:
      "leave.balance.read",

    async run() {
      return {
        remaining: 12
      };
    }
  });

export const leaveRequest =
  workflow({
    id:
      "hr.leave.request",
    version:
      "2",

    async run(input: {
      employeeId: string;
      days: number;
      reason: string;
    }) {
      const balance =
        await checkBalance();

      if (
        balance.remaining <
        input.days
      ) {
        return {
          approved: false
        };
      }

      const manager =
        await surface({
          kind:
            "hr.leave.manager-approval",
          data: {
            input,
            balance
          }
        });

      if (
        manager.type !==
          "approve"
      ) {
        return {
          approved: false
        };
      }

      if (
        input.days > 3
      ) {
        const director =
          await surface({
            kind:
              "hr.leave.director-approval",
          data: {
            input
          }
        });

        if (
          director.type !==
            "approve"
        ) {
          return {
            approved: false
          };
        }
      }

      return {
        approved: true
      };
    }
  });
