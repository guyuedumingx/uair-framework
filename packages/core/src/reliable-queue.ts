import {
  randomUUID
} from "node:crypto";
import type {
  WorkerDispatcher,
  RoutedResumeJob
} from "./worker-router.js";
import {
  WorkerDirectory,
  NoCompatibleWorkerError
} from "./routing.js";
import type {
  SharedWorkerRegistry
} from "./worker-registry.js";
import {
  syncWorkerDirectory
} from "./worker-registry.js";

export type ReliableJobState =
  | "queued"
  | "leased"
  | "dead";

export type ReliableJobRecord = {
  jobId: string;
  job: RoutedResumeJob;
  state: ReliableJobState;
  attempt: number;
  maxAttempts: number;
  availableAt: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

export type ReliableQueueOptions = {
  visibilityTimeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: (
    attempt: number
  ) => number;
};

export type MaybePromise<T> =
  | T
  | Promise<T>;

export interface JobQueue
  extends WorkerDispatcher {
  list():
    MaybePromise<
      ReliableJobRecord[]
    >;

  deadLetters():
    MaybePromise<
      ReliableJobRecord[]
    >;

  claim(
    workerId: string,
    now?: number
  ): MaybePromise<
    ReliableJobRecord | null
  >;

  ack(
    jobId: string,
    leaseToken: string,
    now?: number
  ): MaybePromise<void>;

  nack(
    jobId: string,
    leaseToken: string,
    reason: string,
    now?: number
  ): MaybePromise<void>;

  extendLease(
    jobId: string,
    leaseToken: string,
    now?: number
  ): MaybePromise<number>;

  reclaimExpired(
    now?: number
  ): MaybePromise<number>;

  reclaimWorker(
    workerId: string,
    now?: number
  ): MaybePromise<number>;

  routePending(
    now?: number
  ): MaybePromise<number>;

  unassigned(
    now?: number
  ): MaybePromise<
    ReliableJobRecord[]
  >;

  assign(
    jobId: string,
    workerId: string,
    now?: number
  ): MaybePromise<boolean>;
}

export class InvalidJobLeaseError
  extends Error {
  constructor(
    readonly jobId: string
  ) {
    super(
      `Invalid or expired lease for job ${jobId}`
    );

    this.name =
      "InvalidJobLeaseError";
  }
}

/**
 * In-memory reference implementation of a reliable routed queue.
 *
 * Production implementations can map the same semantics to SQS,
 * Postgres SKIP LOCKED, Redis Streams, NATS JetStream, etc.
 */
export class ReliableWorkerQueue
  implements JobQueue {
  private readonly records =
    new Map<
      string,
      ReliableJobRecord
    >();

  private readonly visibilityTimeoutMs:
    number;

  private readonly maxAttempts:
    number;

  private readonly backoffMs:
    (
      attempt: number
    ) => number;

  constructor(
    private readonly directory:
      WorkerDirectory,
    options:
      ReliableQueueOptions = {}
  ) {
    this.visibilityTimeoutMs =
      options.visibilityTimeoutMs ??
      30_000;

    this.maxAttempts =
      options.maxAttempts ??
      5;

    this.backoffMs =
      options.backoffMs ??
      (
        attempt =>
          Math.min(
            60_000,
            100 *
              2 ** Math.max(
                0,
                attempt - 1
              )
          )
      );
  }

  async dispatch(
    job: RoutedResumeJob
  ) {
    const now = Date.now();

    const record:
      ReliableJobRecord = {
      jobId:
        `job_${randomUUID()}`,
      job: {
        ...job
      },
      state: "queued",
      attempt: 0,
      maxAttempts:
        this.maxAttempts,
      availableAt: now,
      createdAt: now,
      updatedAt: now
    };

    this.records.set(
      record.jobId,
      record
    );
  }

  list() {
    return [
      ...this.records.values()
    ].map(
      item => ({
        ...item,
        job: {
          ...item.job,
          route: {
            ...item.job.route
          }
        }
      })
    );
  }

  deadLetters() {
    return this.list()
      .filter(
        item =>
          item.state === "dead"
      );
  }

  claim(
    workerId: string,
    now = Date.now()
  ) {
    this.reclaimExpired(now);

    const candidate =
      this.list()
        .filter(
          item =>
            item.state ===
              "queued" &&
            item.job.workerId ===
              workerId &&
            item.availableAt <= now
        )
        .sort(
          (a, b) =>
            a.availableAt -
              b.availableAt ||
            a.createdAt -
              b.createdAt
        )[0];

    if (!candidate) {
      return null;
    }

    const record =
      this.records.get(
        candidate.jobId
      )!;

    record.state =
      "leased";

    record.attempt += 1;

    record.leaseOwner =
      workerId;

    record.leaseToken =
      `lease_${randomUUID()}`;

    record.leaseExpiresAt =
      now +
      this.visibilityTimeoutMs;

    record.updatedAt = now;

    this.directory
      .incrementQueue(
        workerId,
        -1
      );

    this.directory
      .incrementActive(
        workerId,
        1
      );

    return {
      ...record,
      job: {
        ...record.job,
        route: {
          ...record.job.route
        }
      }
    };
  }

  ack(
    jobId: string,
    leaseToken: string,
    now = Date.now()
  ) {
    const record =
      this.requireLease(
        jobId,
        leaseToken,
        now
      );

    this.directory
      .incrementActive(
        record.job.workerId,
        -1
      );

    this.records.delete(
      jobId
    );
  }

  nack(
    jobId: string,
    leaseToken: string,
    reason: string,
    now = Date.now()
  ) {
    const record =
      this.requireLease(
        jobId,
        leaseToken,
        now
      );

    this.directory
      .incrementActive(
        record.job.workerId,
        -1
      );

    record.lastError =
      reason;

    this.retryOrDead(
      record,
      now
    );
  }

  extendLease(
    jobId: string,
    leaseToken: string,
    now = Date.now()
  ) {
    const record =
      this.requireLease(
        jobId,
        leaseToken,
        now
      );

    record.leaseExpiresAt =
      now +
      this.visibilityTimeoutMs;

    record.updatedAt = now;

    return record.leaseExpiresAt;
  }

  /**
   * Immediately reclaims all leases owned by a dead/evicted worker.
   */
  reclaimWorker(
    workerId: string,
    now = Date.now()
  ) {
    let count = 0;

    for (
      const record
      of this.records.values()
    ) {
      if (
        record.state ===
          "leased" &&
        record.leaseOwner ===
          workerId
      ) {
        this.directory
          .incrementActive(
            workerId,
            -1
          );

        record.lastError =
          "worker reclaimed";

        this.retryOrDead(
          record,
          now
        );

        count += 1;
      }
    }

    return count;
  }

  /**
   * Visibility-timeout redelivery. A retry is routed again using the
   * current WorkerDirectory so another compatible worker may take it.
   */
  reclaimExpired(
    now = Date.now()
  ) {
    let count = 0;

    for (
      const record
      of this.records.values()
    ) {
      if (
        record.state !==
          "leased" ||
        record.leaseExpiresAt ===
          undefined ||
        record.leaseExpiresAt > now
      ) {
        continue;
      }

      if (record.leaseOwner) {
        this.directory
          .incrementActive(
            record.leaseOwner,
            -1
          );
      }

      record.lastError =
        "visibility timeout";

      this.retryOrDead(
        record,
        now
      );

      count += 1;
    }

    return count;
  }

  private retryOrDead(
    record:
      ReliableJobRecord,
    now: number
  ) {
    record.leaseOwner =
      undefined;

    record.leaseToken =
      undefined;

    record.leaseExpiresAt =
      undefined;

    if (
      record.attempt >=
        record.maxAttempts
    ) {
      record.state = "dead";
      record.updatedAt = now;
      return;
    }

    record.state = "queued";

    record.availableAt =
      now +
      this.backoffMs(
        record.attempt
      );

    record.updatedAt = now;

    // Redelivery returns to an unassigned state. Shared-registry
    // schedulers can then perform atomic select + reserve before assign.
    record.job.workerId = "";

  }

  /**
   * Re-attempt routing of queued jobs which currently have no worker.
   */
  unassigned(
    now = Date.now()
  ) {
    return this.list()
      .filter(
        record =>
          record.state === "queued" &&
          !record.job.workerId &&
          record.availableAt <= now
      );
  }

  assign(
    jobId: string,
    workerId: string,
    now = Date.now()
  ) {
    const record =
      this.records.get(jobId);

    if (
      !record ||
      record.state !== "queued" ||
      record.job.workerId ||
      record.availableAt > now
    ) {
      return false;
    }

    record.job.workerId = workerId;
    record.updatedAt = now;
    return true;
  }

  routePending(
    now = Date.now()
  ) {
    let routed = 0;

    for (
      const record
      of this.records.values()
    ) {
      if (
        record.state !==
          "queued" ||
        record.job.workerId ||
        record.availableAt > now
      ) {
        continue;
      }

      try {
        const selected =
          this.directory.select(
            record.job.route,
            {
              intent: "resume",
              now
            }
          );

        record.job.workerId =
          selected.worker
            .workerId;

        this.directory
          .incrementQueue(
            record.job.workerId,
            1
          );

        record.updatedAt = now;
        routed += 1;
      } catch (
        error
      ) {
        if (
          !(error instanceof
            NoCompatibleWorkerError)
        ) {
          throw error;
        }
      }
    }

    return routed;
  }

  private requireLease(
    jobId: string,
    leaseToken: string,
    now: number
  ) {
    const record =
      this.records.get(
        jobId
      );

    if (
      !record ||
      record.state !==
        "leased" ||
      record.leaseToken !==
        leaseToken ||
      record.leaseExpiresAt ===
        undefined ||
      record.leaseExpiresAt < now
    ) {
      throw new InvalidJobLeaseError(
        jobId
      );
    }

    return record;
  }
}

export interface RoutedJobHandler {
  handle(
    job: RoutedResumeJob
  ): Promise<unknown>;
}

/**
 * Reference worker loop for reliable queue semantics.
 * The queue owns lease/ack/redelivery counters; the handler owns only
 * execution semantics.
 */
export class ReliableWorkerConsumer {
  constructor(
    readonly workerId: string,
    private readonly queue:
      JobQueue,
    private readonly handler:
      RoutedJobHandler
  ) {}

  async runOne(
    now = Date.now()
  ) {
    const leased =
      await this.queue.claim(
        this.workerId,
        now
      );

    if (!leased) {
      return null;
    }

    try {
      const result =
        await this.handler
          .handle(
            leased.job
          );

      await this.queue.ack(
        leased.jobId,
        leased.leaseToken!,
        Date.now()
      );

      return {
        jobId:
          leased.jobId,
        status:
          "acked" as const,
        result
      };
    } catch (error: any) {
      await this.queue.nack(
        leased.jobId,
        leased.leaseToken!,
        error?.message ??
          String(error),
        Date.now()
      );

      return {
        jobId:
          leased.jobId,
        status:
          "nacked" as const,
        error
      };
    }
  }
}


/**
 * Scheduler maintenance loop with no leader election requirement.
 * Correctness is delegated to the JobQueue backend's atomic state
 * transitions. Multiple scheduler instances may call tick().
 */
export class LeaderlessQueueScheduler {
  constructor(
    private readonly queue:
      JobQueue
  ) {}

  async tick(
    now = Date.now()
  ) {
    const reclaimed =
      await this.queue
        .reclaimExpired(now);

    const routed =
      await this.queue
        .routePending(now);

    return {
      reclaimed,
      routed
    };
  }
}


/**
 * Leaderless scheduler using a shared worker registry as the source of
 * truth for discovery/load and a local WorkerDirectory only as a
 * disposable routing projection used by the JobQueue implementation.
 */
export class SharedRegistryQueueScheduler {
  constructor(
    private readonly queue:
      JobQueue,
    private readonly registry:
      SharedWorkerRegistry,
    private readonly directory:
      WorkerDirectory
  ) {}

  async tick(
    now = Date.now()
  ) {
    await syncWorkerDirectory(
      this.registry,
      this.directory,
      now
    );

    const reclaimed =
      await this.queue
        .reclaimExpired(now);

    // reclaimExpired may update the local projection. Refresh again so
    // routePending uses the latest shared heartbeat/load truth rather
    // than scheduler-local counters.
    await syncWorkerDirectory(
      this.registry,
      this.directory,
      now
    );

    const routed =
      await this.queue
        .routePending(now);

    return {
      reclaimed,
      routed
    };
  }
}

/**
 * Shared-registry scheduler with atomic capacity admission.
 *
 * For every unassigned queued job:
 * 1. atomically select + reserve one worker slot in SharedWorkerRegistry
 * 2. conditionally bind the job to that worker
 * 3. release the reservation if another scheduler won the job race
 *
 * This prevents two schedulers from consuming the same last worker slot.
 */
export class AtomicCapacityQueueScheduler {
  constructor(
    private readonly queue: JobQueue,
    private readonly registry: SharedWorkerRegistry
  ) {}

  async tick(
    now = Date.now()
  ) {
    const reclaimed =
      await this.queue
        .reclaimExpired(now);

    const pending =
      await this.queue
        .unassigned(now);

    let routed = 0;

    for (const record of pending) {
      let reservation:
        import("./worker-registry.js")
          .CapacityReservation |
        undefined;

      try {
        reservation =
          await this.registry
            .reserveCapacity(
              record.job.route,
              {
                intent: "resume",
                now
              }
            );

        const assigned =
          await this.queue
            .assign(
              record.jobId,
              reservation.workerId,
              now
            );

        if (!assigned) {
          await this.registry
            .releaseCapacity(
              reservation,
              now
            );

          continue;
        }

        routed += 1;
      } catch (error) {
        if (reservation) {
          await this.registry
            .releaseCapacity(
              reservation,
              now
            );
        }

        if (
          error instanceof
            NoCompatibleWorkerError
        ) {
          continue;
        }

        throw error;
      }
    }

    return {
      reclaimed,
      routed
    };
  }
}
