import type {
  MaybePromise
} from "./reliable-queue.js";
import {
  WorkerDirectory,
  type WorkerRegistration,
  type WorkerLifecycle,
  type ExecutionRoute,
  type RoutingIntent,
  NoCompatibleWorkerError
} from "./routing.js";

export type CapacityReservation = {
  workerId: string;
  route: ExecutionRoute;
  intent: RoutingIntent;
  reservedAt: number;
};

export interface SharedWorkerRegistry {
  register(
    worker: WorkerRegistration,
    now?: number
  ): MaybePromise<void>;

  heartbeat(
    workerId: string,
    patch?: Partial<
      Pick<
        WorkerRegistration,
        | "queueDepth"
        | "activeJobs"
        | "capacity"
        | "lifecycle"
        | "metadata"
      >
    >,
    now?: number
  ): MaybePromise<void>;

  setLifecycle(
    workerId: string,
    lifecycle: WorkerLifecycle,
    now?: number
  ): MaybePromise<void>;

  remove(
    workerId: string
  ): MaybePromise<void>;

  list(
    now?: number
  ): MaybePromise<WorkerRegistration[]>;

  /**
   * Atomically selects a compatible worker and reserves one queue slot.
   * Implementations MUST ensure two schedulers cannot reserve the same
   * last capacity slot concurrently.
   */
  reserveCapacity(
    route: ExecutionRoute,
    options?: {
      intent?: RoutingIntent;
      now?: number;
    }
  ): MaybePromise<CapacityReservation>;

  /** Releases a previously reserved queue slot, e.g. when dispatch fails. */
  releaseCapacity(
    reservation: CapacityReservation,
    now?: number
  ): MaybePromise<void>;
}

export async function snapshotWorkerDirectory(
  registry: SharedWorkerRegistry,
  now = Date.now()
) {
  const directory = new WorkerDirectory();
  const workers = await registry.list(now);
  for (const worker of workers) directory.register(worker);
  return directory;
}

export async function selectSharedWorker(
  registry: SharedWorkerRegistry,
  route: ExecutionRoute,
  options: {
    intent?: RoutingIntent;
    now?: number;
  } = {}
) {
  const now = options.now ?? Date.now();
  const directory = await snapshotWorkerDirectory(registry, now);
  return directory.select(route, {
    intent: options.intent,
    now
  });
}

export async function reserveSharedWorker(
  registry: SharedWorkerRegistry,
  route: ExecutionRoute,
  options: {
    intent?: RoutingIntent;
    now?: number;
  } = {}
) {
  return registry.reserveCapacity(route, options);
}

export class WorkerHeartbeatPublisher {
  constructor(
    private readonly registry: SharedWorkerRegistry,
    readonly workerId: string
  ) {}

  publish(
    state: {
      queueDepth?: number;
      activeJobs?: number;
      capacity?: number;
      lifecycle?: WorkerLifecycle;
      metadata?: Record<string, string | number | boolean>;
    } = {},
    now = Date.now()
  ) {
    return this.registry.heartbeat(this.workerId, state, now);
  }
}

export async function syncWorkerDirectory(
  registry: SharedWorkerRegistry,
  directory: WorkerDirectory,
  now = Date.now()
) {
  const workers = await registry.list(now);
  directory.replaceAll(workers);
  return directory;
}

export { NoCompatibleWorkerError };
