import {
  createRbac
} from "@uair/security";
import {
  createOaPackage
} from "@uair/oa";

const rbac =
  createRbac([
    {
      role: "employee",
      allow: [
        "oa.leave.submit"
      ]
    },
    {
      role: "manager",
      allow: [
        "oa.leave.submit",
        "oa.leave.approve",
        "oa.leave.persist"
      ]
    }
  ]);

export const oa =
  createOaPackage({
    requirePermission:
      rbac.requirePermission
  });

console.log(
  "Enterprise package ready:",
  oa.leaveWorkflow.name
);
