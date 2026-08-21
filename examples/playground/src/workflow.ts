import {
  component,
  workflow,
  parallel
} from "@uair/core";
import {
  agent,
  type AgentModel,
  asAgentTool
} from "@uair/agent";
import {
  ui
} from "@uair/ui";

const permission =
  component<
    {
      user: string;
      task: string;
    },
    {
      allowed: true;
    }
  >(
    "demo.permission",
    async () => ({
      allowed: true
    })
  );


const retryProbe =
  component<
    string,
    {
      ok: true;
      attempt: number;
    }
  >(
    "demo.retryProbe",
    {
      retry: {
        maxAttempts: 2
      }
    },
    async (
      task,
      ctx
    ) => {
      if (
        ctx.attempt === 1
      ) {
        throw new Error(
          "simulated transient failure"
        );
      }

      return {
        ok: true,
        attempt:
          ctx.attempt
      };
    }
  );

const policyLookup =
  component<
    string,
    string
  >(
    "demo.parallel.policy",
    async task => {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            90
          )
      );

      return `Policy checked for ${task}`;
    }
  );

const contextLookup =
  component<
    string,
    string
  >(
    "demo.parallel.context",
    async task => {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            45
          )
      );

      return `Context loaded for ${task}`;
    }
  );

const search =
  component<
    Record<string, unknown> | undefined,
    {
      matches: string[];
    }
  >(
    "demo.search",
    {
      attributes: {
        "demo.kind":
          "search"
      }
    },
    async (
      input,
      ctx
    ) => {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            55
          )
      );

      ctx.addMetric(
        "demo.result_count",
        3
      );

      return {
        matches: [
          `Result for ${String(input?.query ?? "")}`,
          "Policy document",
          "Expense report"
        ]
      };
    }
  );

const summarize =
  component<
    Record<string, unknown> | undefined,
    {
      summary: string;
    }
  >(
    "demo.summarize",
    {
      attributes: {
        "demo.kind":
          "summarize"
      }
    },
    async (
      input,
      ctx
    ) => {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            35
          )
      );

      ctx.setAttribute(
        "demo.summary.mode",
        "manager-ready"
      );

      return {
        summary:
          `Summary prepared for ${String(input?.topic ?? "task")}`
      };
    }
  );

class DemoModel
  implements AgentModel {
  async decide(context: any) {
    if (
      context.steps.length === 0
    ) {
      return {
        type: "tool" as const,
        tool: search.id,
        args: {
          query:
            context.input.task
        }
      };
    }

    if (
      context.steps.length === 1
    ) {
      return {
        type: "tool" as const,
        tool: summarize.id,
        args: {
          topic:
            context.input.task
        }
      };
    }

    return {
      type: "final" as const,
      value: {
        task:
          context.input.task,
        search:
          context.steps[0].result,
        summary:
          context.steps[1].result
      }
    };
  }
}

const worker =
  agent(
    "demo-agent",
    new DemoModel(),
    [
      asAgentTool(
        search as any,
        {
          description:
            "Search demo data"
        }
      ),
      asAgentTool(
        summarize as any,
        {
          description:
            "Summarize the task"
        }
      )
    ]
  );

export const approval =
  ui<
    {
      task: string;
      proposal: unknown;
    },
    {
      approved: boolean;
      comment?: string;
    }
  >(
    "ManagerApproval",
    {
      version: "1"
    }
  );

const audit =
  component<
    {
      task: string;
      approved: boolean;
    },
    {
      auditId: string;
    }
  >(
    "demo.audit",
    async input => ({
      auditId:
        `audit:${input.task}:${input.approved ? "approved" : "rejected"}`
    })
  );

export const playgroundWorkflow =
  workflow(
    "playground.demo",
    async (
      input: {
        user: string;
        task: string;
      }
    ) => {
      await permission(input);

      await retryProbe(
        input.task
      );

      await parallel([
        () =>
          policyLookup(
            input.task
          ),
        () =>
          contextLookup(
            input.task
          )
      ] as const);

      const proposal =
        await worker(input);

      const decision =
        await approval({
          task:
            input.task,
          proposal
        });

      const auditResult =
        await audit({
          task:
            input.task,
          approved:
            decision.approved
        });

      return {
        task:
          input.task,
        proposal,
        decision,
        audit:
          auditResult
      };
    }
  );
