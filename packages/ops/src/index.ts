import type {
  Storage
} from "@uair/core/runtime";

export type UairErrorCategory =
  | "conflict"
  | "compatibility"
  | "authorization"
  | "security"
  | "routing"
  | "lease"
  | "dependency"
  | "unknown";

export type UairErrorDisposition =
  | "retry"
  | "operator"
  | "deny"
  | "upgrade"
  | "unknown";

export type ClassifiedError = {
  category:
    UairErrorCategory;
  disposition:
    UairErrorDisposition;
  code: string;
  retryable: boolean;
  message: string;
  causeName?: string;
};

const byName:
  Record<
    string,
    Omit<
      ClassifiedError,
      "message" |
      "causeName"
    >
  > = {
    StorageConflictError: {
      category:
        "conflict",
      disposition:
        "retry",
      code:
        "UAIR_STORAGE_CONFLICT",
      retryable:
        true
    },
    WorkflowVersionMismatchError: {
      category:
        "compatibility",
      disposition:
        "upgrade",
      code:
        "UAIR_WORKFLOW_VERSION_MISMATCH",
      retryable:
        false
    },
    HistorySchemaTooNewError: {
      category:
        "compatibility",
      disposition:
        "upgrade",
      code:
        "UAIR_HISTORY_SCHEMA_TOO_NEW",
      retryable:
        false
    },
    CapabilityPermissionDeniedError: {
      category:
        "authorization",
      disposition:
        "deny",
      code:
        "UAIR_CAPABILITY_DENIED",
      retryable:
        false
    },
    RawSecretPersistenceError: {
      category:
        "security",
      disposition:
        "deny",
      code:
        "UAIR_RAW_SECRET_PERSISTENCE",
      retryable:
        false
    },
    McpConnectionDeniedError: {
      category:
        "security",
      disposition:
        "deny",
      code:
        "UAIR_MCP_CONNECTION_DENIED",
      retryable:
        false
    },
    NoCompatibleWorkerError: {
      category:
        "routing",
      disposition:
        "operator",
      code:
        "UAIR_NO_COMPATIBLE_WORKER",
      retryable:
        true
    },
    InvalidJobLeaseError: {
      category:
        "lease",
      disposition:
        "retry",
      code:
        "UAIR_INVALID_JOB_LEASE",
      retryable:
        true
    }
  };

export function classifyError(
  error: unknown
): ClassifiedError {
  const causeName =
    error instanceof Error
      ? error.name
      : undefined;

  const known =
    causeName
      ? byName[causeName]
      : undefined;

  const message =
    error instanceof Error
      ? error.message
      : String(error);

  if (known) {
    return {
      ...known,
      message,
      causeName
    };
  }

  return {
    category:
      "unknown",
    disposition:
      "unknown",
    code:
      "UAIR_UNKNOWN",
    retryable:
      false,
    message,
    causeName
  };
}

export type HealthStatus =
  | "up"
  | "degraded"
  | "down";

export type HealthCheckResult = {
  name: string;
  status:
    HealthStatus;
  message?: string;
  observedAt: number;
  details?: Record<
    string,
    string |
    number |
    boolean
  >;
};

export type HealthReport = {
  status:
    HealthStatus;
  ready: boolean;
  checks:
    HealthCheckResult[];
  observedAt: number;
};

export type HealthCheck =
  () =>
    Promise<
      HealthCheckResult
    > |
    HealthCheckResult;

function worst(
  checks:
    HealthCheckResult[]
): HealthStatus {
  if (
    checks.some(
      check =>
        check.status ===
          "down"
    )
  ) {
    return "down";
  }

  if (
    checks.some(
      check =>
        check.status ===
          "degraded"
    )
  ) {
    return "degraded";
  }

  return "up";
}

export async function healthReport(
  checks:
    HealthCheck[],
  now = Date.now()
): Promise<HealthReport> {
  const results =
    await Promise.all(
      checks.map(
        async check => {
          try {
            return await check();
          } catch (error) {
            return {
              name:
                "unhandled",
              status:
                "down" as const,
              message:
                error instanceof Error
                  ? error.message
                  : String(error),
              observedAt:
                now
            };
          }
        }
      )
    );

  const status =
    worst(results);

  return {
    status,
    ready:
      status === "up",
    checks:
      results,
    observedAt:
      now
  };
}

export function storageHealthCheck(
  storage:
    Storage,
  name =
    "runtime-storage"
): HealthCheck {
  return async () => {
    const observedAt =
      Date.now();

    try {
      await storage
        .listExecutions();

      return {
        name,
        status:
          "up",
        observedAt
      };
    } catch (error) {
      return {
        name,
        status:
          "down",
        observedAt,
        message:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  };
}

export type WorkerLike = {
  workerId: string;
  lifecycle?:
    "active" |
    "draining" |
    "offline";
  queueDepth?: number;
  activeJobs?: number;
  lastHeartbeatAt?:
    number;
  heartbeatLeaseMs?:
    number;
};

export type WorkerRegistryLike = {
  list(
    now?: number
  ):
    Promise<
      WorkerLike[]
    > |
    WorkerLike[];
  setLifecycle(
    workerId: string,
    lifecycle:
      "active" |
      "draining" |
      "offline",
    now?: number
  ):
    Promise<void> |
    void;
};

export function workerRegistryHealthCheck(
  registry:
    WorkerRegistryLike,
  options: {
    name?: string;
    requireActive?: boolean;
  } = {}
): HealthCheck {
  return async () => {
    const observedAt =
      Date.now();

    try {
      const workers =
        await registry.list(
          observedAt
        );

      const live =
        workers.filter(
          worker => {
            if (
              worker.lifecycle ===
                "offline"
            ) {
              return false;
            }

            if (
              worker.lastHeartbeatAt ===
                undefined ||
              worker.heartbeatLeaseMs ===
                undefined
            ) {
              return true;
            }

            return (
              observedAt -
                worker.lastHeartbeatAt <=
              worker.heartbeatLeaseMs
            );
          }
        );

      const active =
        live.filter(
          worker =>
            (
              worker.lifecycle ??
              "active"
            ) === "active"
        );

      const status =
        (
          options.requireActive ??
          true
        ) &&
        active.length === 0
          ? "down"
          : live.length === 0
            ? "degraded"
            : "up";

      return {
        name:
          options.name ??
          "worker-registry",
        status,
        observedAt,
        details: {
          workers:
            workers.length,
          live:
            live.length,
          active:
            active.length
        }
      };
    } catch (error) {
      return {
        name:
          options.name ??
          "worker-registry",
        status:
          "down",
        observedAt,
        message:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  };
}

export type DrainResult = {
  workerId: string;
  drained: boolean;
  remaining: number;
  startedAt: number;
  finishedAt: number;
};

export async function drainWorker(
  registry:
    WorkerRegistryLike,
  workerId: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (
      ms: number
    ) => Promise<void>;
  } = {}
): Promise<DrainResult> {
  const now =
    options.now ??
    Date.now;

  const sleep =
    options.sleep ??
    (
      ms =>
        new Promise(
          resolve =>
            setTimeout(
              resolve,
              ms
            )
        )
    );

  const timeoutMs =
    options.timeoutMs ??
    30_000;

  const pollMs =
    options.pollMs ??
    100;

  const startedAt =
    now();

  await registry
    .setLifecycle(
      workerId,
      "draining",
      startedAt
    );

  while (
    now() -
      startedAt <=
    timeoutMs
  ) {
    const workers =
      await registry.list(
        now()
      );

    const worker =
      workers.find(
        candidate =>
          candidate.workerId ===
          workerId
      );

    if (!worker) {
      return {
        workerId,
        drained:
          true,
        remaining:
          0,
        startedAt,
        finishedAt:
          now()
      };
    }

    const remaining =
      (
        worker.queueDepth ??
        0
      ) +
      (
        worker.activeJobs ??
        0
      );

    if (remaining === 0) {
      await registry
        .setLifecycle(
          workerId,
          "offline",
          now()
        );

      return {
        workerId,
        drained:
          true,
        remaining:
          0,
        startedAt,
        finishedAt:
          now()
      };
    }

    await sleep(
      pollMs
    );
  }

  const worker =
    (
      await registry.list(
        now()
      )
    ).find(
      candidate =>
        candidate.workerId ===
        workerId
    );

  return {
    workerId,
    drained:
      false,
    remaining:
      (
        worker?.queueDepth ??
        0
      ) +
      (
        worker?.activeJobs ??
        0
      ),
    startedAt,
    finishedAt:
      now()
  };
}

export type DeadLetter = {
  jobId: string;
  state: string;
  attempt: number;
  maxAttempts: number;
  lastError?: string;
  updatedAt: number;
  job: {
    executionId: string;
    workerId: string;
    [key: string]:
      unknown;
  };
};

export type RecoverableDeadLetterQueue = {
  deadLetters():
    Promise<
      DeadLetter[]
    > |
    DeadLetter[];
  requeueDead(
    jobId: string,
    options?: {
      resetAttempts?:
        boolean;
      now?: number;
    }
  ):
    Promise<boolean> |
    boolean;
};

export async function recoverDeadLetter(
  queue:
    RecoverableDeadLetterQueue,
  jobId: string,
  options: {
    resetAttempts?:
      boolean;
    now?: number;
  } = {}
) {
  const dead =
    (
      await queue
        .deadLetters()
    ).find(
      item =>
        item.jobId ===
        jobId
    );

  if (!dead) {
    return {
      recovered:
        false,
      reason:
        "not-dead-letter" as const
    };
  }

  const recovered =
    await queue
      .requeueDead(
        jobId,
        options
      );

  return {
    recovered,
    reason:
      recovered
        ? "requeued" as const
        : "conflict" as const
  };
}


export type RuntimeMetricsSnapshot = {
  observedAt: number;
  executions: {
    total: number;
    running: number;
    suspended: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  pendingSuspensions: number;
  workers?: {
    total: number;
    active: number;
    draining: number;
    offline: number;
    queueDepth: number;
    activeJobs: number;
  };
  deadLetters?: number;
};

export async function collectRuntimeMetrics(
  input: {
    storage:
      Storage;
    workers?:
      WorkerRegistryLike;
    deadLetters?:
      {
        deadLetters():
          Promise<
            unknown[]
          > |
          unknown[];
      };
    now?: () => number;
  }
): Promise<RuntimeMetricsSnapshot> {
  const now =
    input.now ??
    Date.now;

  const executions =
    await input.storage
      .listExecutions();

  const byStatus =
    (
      status:
        string
    ) =>
      executions.filter(
        execution =>
          execution.status ===
          status
      ).length;

  const pendingSuspensions =
    (
      await input.storage
        .listSuspensions()
    ).length;

  const snapshot:
    RuntimeMetricsSnapshot = {
      observedAt:
        now(),
      executions: {
        total:
          executions.length,
        running:
          byStatus(
            "running"
          ),
        suspended:
          byStatus(
            "suspended"
          ),
        completed:
          byStatus(
            "completed"
          ),
        failed:
          byStatus(
            "failed"
          ),
        cancelled:
          byStatus(
            "cancelled"
          )
      },
      pendingSuspensions
    };

  if (
    input.workers
  ) {
    const workers =
      await input.workers
        .list(
          snapshot
            .observedAt
        );

    snapshot.workers = {
      total:
        workers.length,
      active:
        workers.filter(
          worker =>
            (
              worker.lifecycle ??
              "active"
            ) === "active"
        ).length,
      draining:
        workers.filter(
          worker =>
            worker.lifecycle ===
              "draining"
        ).length,
      offline:
        workers.filter(
          worker =>
            worker.lifecycle ===
              "offline"
        ).length,
      queueDepth:
        workers.reduce(
          (
            sum,
            worker
          ) =>
            sum +
            (
              worker.queueDepth ??
              0
            ),
          0
        ),
      activeJobs:
        workers.reduce(
          (
            sum,
            worker
          ) =>
            sum +
            (
              worker.activeJobs ??
              0
            ),
          0
        )
    };
  }

  if (
    input.deadLetters
  ) {
    snapshot.deadLetters =
      (
        await input
          .deadLetters
          .deadLetters()
      ).length;
  }

  return snapshot;
}
