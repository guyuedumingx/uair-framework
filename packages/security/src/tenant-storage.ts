import type {
  Execution
} from "@uair/core";

import type {
  Storage,
  SuspensionCreated
} from "@uair/core/runtime";

function encode(
  tenantId: string,
  id: string
) {
  return `${tenantId.length}:${tenantId}:${id}`;
}

function decode(
  tenantId: string,
  id: string
) {
  const prefix =
    `${tenantId.length}:${tenantId}:`;

  if (
    !id.startsWith(
      prefix
    )
  ) {
    return null;
  }

  return id.slice(
    prefix.length
  );
}

function storedExecution(
  tenantId: string,
  execution:
    Execution
): Execution {
  return {
    ...structuredClone(
      execution
    ),
    id:
      encode(
        tenantId,
        execution.id
      )
  };
}

function visibleExecution(
  tenantId: string,
  execution:
    Execution
): Execution | null {
  const id =
    decode(
      tenantId,
      execution.id
    );

  if (id === null) {
    return null;
  }

  return {
    ...structuredClone(
      execution
    ),
    id
  };
}

/**
 * Host-layer logical namespace for shared Storage implementations.
 *
 * Strongest production isolation is still separate database/schema/credentials
 * per tenant. This wrapper prevents accidental/ID-guess cross-tenant reads
 * when a shared backing store is intentionally used.
 */
export class TenantStorage
  implements Storage {
  constructor(
    readonly tenantId:
      string,
    private readonly inner:
      Storage
  ) {
    if (
      tenantId.trim() ===
        ""
    ) {
      throw new Error(
        "TenantStorage requires a non-empty tenantId."
      );
    }
  }

  async loadExecution(
    id: string
  ) {
    const execution =
      await this.inner
        .loadExecution(
          encode(
            this.tenantId,
            id
          )
        );

    return execution
      ? visibleExecution(
          this.tenantId,
          execution
        )
      : null;
  }

  async saveExecution(
    execution:
      Execution,
    expectedRevision?:
      number
  ) {
    const stored =
      storedExecution(
        this.tenantId,
        execution
      );

    await this.inner
      .saveExecution(
        stored,
        expectedRevision
      );

    execution.revision =
      stored.revision;
  }

  async listExecutions() {
    const executions =
      await this.inner
        .listExecutions();

    return executions
      .map(
        execution =>
          visibleExecution(
            this.tenantId,
            execution
          )
      )
      .filter(
        (
          execution
        ): execution is
          Execution =>
            execution !==
            null
      );
  }

  async findSuspension(
    suspensionId: string
  ): Promise<{
    executionId: string;
    suspension:
      SuspensionCreated;
  } | null> {
    const result =
      await this.inner
        .findSuspension(
          encode(
            this.tenantId,
            suspensionId
          )
        );

    if (!result) {
      return null;
    }

    const executionId =
      decode(
        this.tenantId,
        result.executionId
      );

    if (
      executionId ===
        null
    ) {
      return null;
    }

    return {
      executionId,
      suspension: {
        ...structuredClone(
          result.suspension
        ),
        suspensionId
      }
    };
  }

  async indexSuspension(
    executionId: string,
    suspension:
      SuspensionCreated
  ) {
    await this.inner
      .indexSuspension(
        encode(
          this.tenantId,
          executionId
        ),
        {
          ...structuredClone(
            suspension
          ),
          suspensionId:
            encode(
              this.tenantId,
              suspension.suspensionId
            )
        }
      );
  }

  async removeSuspensionIndex(
    suspensionId: string
  ) {
    await this.inner
      .removeSuspensionIndex(
        encode(
          this.tenantId,
          suspensionId
        )
      );
  }

  async listSuspensions(): Promise<Array<{
    executionId: string;
    suspension:
      SuspensionCreated;
  }>> {
    const all =
      await this.inner
        .listSuspensions();

    return all.flatMap(
      item => {
        const executionId =
          decode(
            this.tenantId,
            item.executionId
          );

        const suspensionId =
          decode(
            this.tenantId,
            item.suspension
              .suspensionId
          );

        if (
          executionId ===
            null ||
          suspensionId ===
            null
        ) {
          return [];
        }

        return [
          {
            executionId,
            suspension: {
              ...structuredClone(
                item.suspension
              ),
              suspensionId
            }
          }
        ];
      }
    );
  }

  async saveExecutionAndIndexSuspension(
    execution:
      Execution,
    suspension:
      SuspensionCreated,
    expectedRevision?:
      number
  ) {
    const stored =
      storedExecution(
        this.tenantId,
        execution
      );

    const indexed = {
      ...structuredClone(
        suspension
      ),
      suspensionId:
        encode(
          this.tenantId,
          suspension.suspensionId
        )
    };

    if (
      this.inner
        .saveExecutionAndIndexSuspension
    ) {
      await this.inner
        .saveExecutionAndIndexSuspension(
          stored,
          indexed,
          expectedRevision
        );

      execution.revision =
        stored.revision;

      return;
    }

    await this.inner
      .saveExecution(
        stored,
        expectedRevision
      );

    await this.inner
      .indexSuspension(
        stored.id,
        indexed
      );

    execution.revision =
      stored.revision;
  }

  async saveExecutionAndRemoveSuspension(
    execution:
      Execution,
    suspensionId: string,
    expectedRevision?:
      number
  ) {
    const stored =
      storedExecution(
        this.tenantId,
        execution
      );

    const indexed =
      encode(
        this.tenantId,
        suspensionId
      );

    if (
      this.inner
        .saveExecutionAndRemoveSuspension
    ) {
      await this.inner
        .saveExecutionAndRemoveSuspension(
          stored,
          indexed,
          expectedRevision
        );

      execution.revision =
        stored.revision;

      return;
    }

    await this.inner
      .saveExecution(
        stored,
        expectedRevision
      );

    await this.inner
      .removeSuspensionIndex(
        indexed
      );

    execution.revision =
      stored.revision;
  }
}
