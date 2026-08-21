import type {
  Execution
} from "./types.js";

export type ExecutionRoute = {
  workflow: string;
  workflowVersion: string;
  deploymentId?: string;
  workflowFingerprint?: string;
};

export function routeForExecution(
  execution: Execution
): ExecutionRoute {
  return {
    workflow:
      execution.workflow,
    workflowVersion:
      execution.workflowVersion ??
      "1",
    deploymentId:
      execution.deploymentId,
    workflowFingerprint:
      execution.workflowFingerprint
  };
}

export type WorkerCapability = {
  workerId: string;
  workflow: string;
  workflowVersion: string;
  deploymentId?: string;
  workflowFingerprint?: string;
};

export type WorkerLifecycle =
  | "active"
  | "draining"
  | "offline";

export type WorkerRegistration = {
  workerId: string;
  capabilities:
    WorkerCapability[];

  /**
   * Deprecated compatibility flag. `false` is treated as offline.
   */
  healthy?: boolean;

  lifecycle?:
    WorkerLifecycle;

  /** Maximum total queued + active jobs. */
  capacity?: number;

  queueDepth?: number;
  activeJobs?: number;

  /** Last liveness heartbeat recorded by the scheduler. */
  lastHeartbeatAt?: number;

  /** Worker is considered expired after this interval. */
  heartbeatLeaseMs?: number;

  metadata?: Record<
    string,
    string | number | boolean
  >;
};

export type RoutingIntent =
  | "resume"
  | "new";

export class NoCompatibleWorkerError
  extends Error {
  constructor(
    readonly route:
      ExecutionRoute,
    readonly intent:
      RoutingIntent = "resume"
  ) {
    super(
      `No compatible worker for ` +
      `${route.workflow}@${route.workflowVersion}` +
      (
        route.deploymentId
          ? ` deployment=${route.deploymentId}`
          : ""
      ) +
      ` intent=${intent}`
    );

    this.name =
      "NoCompatibleWorkerError";
  }
}

function matches(
  route:
    ExecutionRoute,
  capability:
    WorkerCapability
) {
  if (
    route.workflow !==
      capability.workflow ||
    route.workflowVersion !==
      capability.workflowVersion
  ) {
    return false;
  }

  if (
    route.workflowFingerprint &&
    route.workflowFingerprint !==
      capability.workflowFingerprint
  ) {
    return false;
  }

  if (
    route.deploymentId &&
    route.deploymentId !==
      capability.deploymentId
  ) {
    return false;
  }

  return true;
}

export class WorkerDirectory {
  private readonly workers =
    new Map<
      string,
      WorkerRegistration
    >();

  register(
    worker:
      WorkerRegistration
  ) {
    this.workers.set(
      worker.workerId,
      {
        lifecycle:
          worker.healthy === false
            ? "offline"
            : worker.lifecycle ??
              "active",
        capacity:
          worker.capacity ??
          Number.POSITIVE_INFINITY,
        queueDepth:
          worker.queueDepth ?? 0,
        activeJobs:
          worker.activeJobs ?? 0,
        lastHeartbeatAt:
          worker.lastHeartbeatAt ??
          Date.now(),
        heartbeatLeaseMs:
          worker.heartbeatLeaseMs ??
          30_000,
        ...worker
      }
    );

    return this;
  }

  heartbeat(
    workerId: string,
    patch: Partial<
      Pick<
        WorkerRegistration,
        | "queueDepth"
        | "activeJobs"
        | "capacity"
        | "lifecycle"
      >
    > = {},
    now = Date.now()
  ) {
    const worker =
      this.workers.get(
        workerId
      );

    if (!worker) {
      throw new Error(
        `Worker not registered: ${workerId}`
      );
    }

    Object.assign(
      worker,
      patch,
      {
        lastHeartbeatAt:
          now
      }
    );

    return worker;
  }

  setLifecycle(
    workerId: string,
    lifecycle:
      WorkerLifecycle
  ) {
    const worker =
      this.workers.get(
        workerId
      );

    if (!worker) {
      throw new Error(
        `Worker not registered: ${workerId}`
      );
    }

    worker.lifecycle =
      lifecycle;

    return worker;
  }

  remove(
    workerId: string
  ) {
    this.workers.delete(
      workerId
    );
  }

  list() {
    return [
      ...this.workers.values()
    ];
  }

  replaceAll(
    workers:
      WorkerRegistration[]
  ) {
    this.workers.clear();

    for (const worker of workers) {
      this.register(worker);
    }

    return this;
  }

  isLeaseValid(
    worker:
      WorkerRegistration,
    now = Date.now()
  ) {
    const last =
      worker.lastHeartbeatAt ??
      0;

    const lease =
      worker.heartbeatLeaseMs ??
      30_000;

    return (
      now - last <= lease
    );
  }

  isAvailable(
    worker:
      WorkerRegistration,
    intent:
      RoutingIntent,
    now = Date.now()
  ) {
    const lifecycle =
      worker.healthy === false
        ? "offline"
        : worker.lifecycle ??
          "active";

    if (
      lifecycle ===
        "offline" ||
      !this.isLeaseValid(
        worker,
        now
      )
    ) {
      return false;
    }

    // Draining workers may finish already-pinned executions but must
    // not receive brand-new executions/deployment admissions.
    if (
      intent === "new" &&
      lifecycle !== "active"
    ) {
      return false;
    }

    const capacity =
      worker.capacity ??
      Number.POSITIVE_INFINITY;

    const load =
      (worker.queueDepth ?? 0) +
      (worker.activeJobs ?? 0);

    return load < capacity;
  }

  loadRatio(
    worker:
      WorkerRegistration
  ) {
    const capacity =
      worker.capacity ??
      Number.POSITIVE_INFINITY;

    const load =
      (worker.queueDepth ?? 0) +
      (worker.activeJobs ?? 0);

    if (
      !Number.isFinite(
        capacity
      )
    ) {
      return load;
    }

    return load / Math.max(
      1,
      capacity
    );
  }

  findCompatible(
    route:
      ExecutionRoute,
    options: {
      intent?:
        RoutingIntent;
      now?: number;
    } = {}
  ) {
    const intent =
      options.intent ??
      "resume";

    const now =
      options.now ??
      Date.now();

    return this.list()
      .filter(
        worker =>
          this.isAvailable(
            worker,
            intent,
            now
          )
      )
      .flatMap(
        worker =>
          worker.capabilities
            .filter(
              capability =>
                matches(
                  route,
                  capability
                )
            )
            .map(
              capability => ({
                worker,
                capability,
                loadRatio:
                  this.loadRatio(
                    worker
                  )
              })
            )
      );
  }

  select(
    route:
      ExecutionRoute,
    options: {
      intent?:
        RoutingIntent;
      now?: number;
    } = {}
  ) {
    const intent =
      options.intent ??
      "resume";

    const matches =
      this.findCompatible(
        route,
        options
      );

    if (
      matches.length === 0
    ) {
      throw new NoCompatibleWorkerError(
        route,
        intent
      );
    }

    // Prefer the lowest normalized load; deterministic worker ID is
    // the tie-breaker. This remains replaceable by a richer scheduler.
    matches.sort(
      (a, b) =>
        a.loadRatio -
          b.loadRatio ||
        a.worker.workerId
          .localeCompare(
            b.worker.workerId
          )
    );

    return matches[0];
  }

  incrementQueue(
    workerId: string,
    delta: number
  ) {
    const worker =
      this.workers.get(
        workerId
      );

    if (!worker) {
      return;
    }

    worker.queueDepth =
      Math.max(
        0,
        (worker.queueDepth ?? 0) +
          delta
      );
  }

  incrementActive(
    workerId: string,
    delta: number
  ) {
    const worker =
      this.workers.get(
        workerId
      );

    if (!worker) {
      return;
    }

    worker.activeJobs =
      Math.max(
        0,
        (worker.activeJobs ?? 0) +
          delta
      );
  }

  canShutdown(
    workerId: string
  ) {
    const worker =
      this.workers.get(
        workerId
      );

    if (!worker) {
      return true;
    }

    return (
      (worker.lifecycle ??
        "active") ===
        "draining" &&
      (worker.queueDepth ?? 0) ===
        0 &&
      (worker.activeJobs ?? 0) ===
        0
    );
  }
}
