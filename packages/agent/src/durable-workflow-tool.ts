import {
  resume,
  run
} from "@uair/core";

import type {
  WorkflowDefinition
} from "@uair/core";

import type {
  Storage
} from "@uair/core/runtime";

export type DurableWorkflowToolResult<O = unknown> =
  | {
      executionId: string;
      status: "completed";
      result: O;
    }
  | {
      executionId: string;
      status:
        | "running"
        | "suspended"
        | "failed"
        | "cancelled";
      result?: O;
    };

/**
 * Expose a UAIR Workflow as a durable tool to an Agent that is itself the
 * outer orchestrator. This does not move the Agent's context/memory into UAIR.
 */
export function durableWorkflowTool<I, O>(
  workflowDef: WorkflowDefinition<I, O>,
  storage: Storage
) {
  return {
    id: workflowDef.id,

    async start(
      input: I
    ): Promise<DurableWorkflowToolResult<O>> {
      const execution =
        await run(
          workflowDef,
          input,
          storage
        );

      if (
        execution.status ===
          "completed"
      ) {
        return {
          executionId:
            execution.id,
          status:
            "completed",
          result:
            execution.result as O
        };
      }

      return {
        executionId:
          execution.id,
        status:
          execution.status,
        result:
          execution.result as O | undefined
      };
    },

    async resume(
      executionId: string
    ): Promise<DurableWorkflowToolResult<O>> {
      const execution =
        await resume(
          workflowDef,
          executionId,
          storage
        );

      if (
        execution.status ===
          "completed"
      ) {
        return {
          executionId:
            execution.id,
          status:
            "completed",
          result:
            execution.result as O
        };
      }

      return {
        executionId:
          execution.id,
        status:
          execution.status,
        result:
          execution.result as O | undefined
      };
    }
  };
}
