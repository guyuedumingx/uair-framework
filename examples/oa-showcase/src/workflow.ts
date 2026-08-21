import {
  component,
  workflow,
  parallel
} from "@uair/core";
import {
  agent,
  asAgentTool,
  type AgentModel
} from "@uair/agent";
import {
  ui
} from "@uair/ui";

export type ExpenseInput = {
  applicant: string;
  department: string;
  title: string;
  amount: number;
  category: string;
  description: string;
};

const checkIdentity =
  component({
    id: "oa.identity.check",

    async run(input: ExpenseInput) {
      return {
        principal: {
          id: input.applicant,
          roles: [
            "employee"
          ]
        },
        allowed: true
      };
    }
  });

const loadPolicy =
  component({
    id: "oa.policy.lookup",

    async run(input: ExpenseInput) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            180
          )
      );

      return {
        policy: "FIN-EXP-2026",
        managerApprovalThreshold: 3000,
        financeApprovalThreshold: 10000,
        receiptRequired: true,
        category: input.category
      };
    }
  });

const loadBudget =
  component({
    id: "oa.budget.lookup",

    async run(input: ExpenseInput) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            120
          )
      );

      return {
        department: input.department,
        monthlyRemaining: 42800,
        projectedAfterApproval:
          42800 - input.amount
      };
    }
  });

const policyTool =
  component({
    id: "oa.ai.policy-reason",

    async run(input: any) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            140
          )
      );

      const amount =
        Number(
          input?.amount ?? 0
        );

      return {
        risk:
          amount >= 10000
            ? "high"
            : amount >= 3000
              ? "medium"
              : "low",
        reasons: [
          amount >= 3000
            ? "Amount exceeds manager approval threshold"
            : "Amount is within manager self-approval threshold",
          "Receipt evidence is required",
          "Department budget remains positive after approval"
        ],
        recommendedRoute:
          amount >= 10000
            ? [
                "manager",
                "finance"
              ]
            : [
                "manager"
              ]
      };
    }
  });

const draftTool =
  component({
    id: "oa.ai.memo-draft",

    async run(input: any) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            90
          )
      );

      return {
        memo:
          `建议批准该${String(input?.category ?? "费用")}申请。` +
          `金额 ¥${Number(input?.amount ?? 0).toLocaleString("zh-CN")}，` +
          `预算充足，需保留发票并按固定审批链执行。`
      };
    }
  });

class ExpenseModel
  implements AgentModel {
  async decide(context: any) {
    if (
      context.steps.length ===
        0
    ) {
      return {
        type: "tool" as const,
        tool:
          policyTool.id,
        args: {
          amount:
            context.input.amount,
          category:
            context.input.category
        }
      };
    }

    if (
      context.steps.length ===
        1
    ) {
      return {
        type: "tool" as const,
        tool:
          draftTool.id,
        args: {
          amount:
            context.input.amount,
          category:
            context.input.category
        }
      };
    }

    return {
      type: "final" as const,
      value: {
        analysis:
          context.steps[0]
            .result,
        draft:
          context.steps[1]
            .result
      }
    };
  }
}

const aiReviewer =
  agent(
    "oa.ai.reviewer",
    new ExpenseModel(),
    [
      asAgentTool(
        policyTool as any,
        {
          description:
            "Analyze policy, risk and approval route"
        }
      ),
      asAgentTool(
        draftTool as any,
        {
          description:
            "Draft an approval memo"
        }
      )
    ]
  );

export const managerApproval =
  ui<
    {
      request:
        ExpenseInput;
      policy:
        unknown;
      budget:
        unknown;
      ai:
        unknown;
    },
    {
      approved: boolean;
      comment?: string;
    }
  >(
    "ExpenseManagerApproval",
    {
      version: "1"
    }
  );

const persistApproval =
  component({
    id: "oa.expense.persist",

    async run(input: any) {
      return {
        requestId:
          `EXP-${Date.now()
            .toString()
            .slice(-8)}`,
        persisted: true,
        decision:
          input.decision
      };
    }
  });

const mandatoryAudit =
  component({
    id: "oa.audit.append",

    async run(input: any) {
      return {
        auditId:
          `AUD-${Date.now()
            .toString()
            .slice(-8)}`,
        actor:
          input.actor,
        action:
          input.approved
            ? "approved"
            : "rejected",
        immutable: true
      };
    }
  });

export const expenseWorkflow =
  workflow({
    id: "oa.expense.apply",
    version: "1",

    async run(
      input: ExpenseInput
    ) {
      await checkIdentity(
        input
      );

      const [
        policy,
        budget
      ] =
        await parallel([
          () =>
            loadPolicy(
              input
            ),
          () =>
            loadBudget(
              input
            )
        ] as const);

      const ai =
        await aiReviewer(
          input
        );

      const decision =
        await managerApproval({
          request:
            input,
          policy,
          budget,
          ai
        });

      const persisted =
        await persistApproval({
          request:
            input,
          decision
        });

      const audit =
        await mandatoryAudit({
          actor:
            "manager.li",
          approved:
            decision.approved
        });

      return {
        request:
          input,
        policy,
        budget,
        ai,
        decision,
        persisted,
        audit
      };
    }
  });
