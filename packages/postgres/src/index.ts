import {
  randomUUID
} from "node:crypto";
import {
  InvalidJobLeaseError,
  NoCompatibleWorkerError,
  type JobQueue,
  type ReliableJobRecord,
  type ReliableQueueOptions,
  type RoutedResumeJob,
  type WorkerDirectory
} from "@uair/core/cluster";

export type PgQueryResult<Row = any> = {
  rows: Row[];
  rowCount?: number | null;
};

export interface PgQueryable {
  query<Row = any>(
    text: string,
    values?: unknown[]
  ): Promise<PgQueryResult<Row>>;
}

export const POSTGRES_RELIABLE_QUEUE_SCHEMA = `
CREATE TABLE IF NOT EXISTS uair_routed_jobs (
  job_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  assigned_worker_id TEXT,
  job_json JSONB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'dead')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  available_at BIGINT NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at BIGINT,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uair_routed_jobs_claim
ON uair_routed_jobs(state, assigned_worker_id, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_uair_routed_jobs_lease
ON uair_routed_jobs(state, lease_expires_at);
`;

function decodeRecord(
  row: any
): ReliableJobRecord {
  const job =
    typeof row.job_json === "string"
      ? JSON.parse(row.job_json)
      : row.job_json;

  return {
    jobId: String(row.job_id),
    job,
    state: row.state,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    availableAt: Number(row.available_at),
    leaseOwner: row.lease_owner == null ? undefined : String(row.lease_owner),
    leaseToken: row.lease_token == null ? undefined : String(row.lease_token),
    leaseExpiresAt: row.lease_expires_at == null ? undefined : Number(row.lease_expires_at),
    lastError: row.last_error == null ? undefined : String(row.last_error),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

/**
 * Leaderless PostgreSQL queue reference implementation.
 *
 * Multiple scheduler/worker processes may call claim() concurrently.
 * The claim statement uses FOR UPDATE SKIP LOCKED inside a CTE and
 * atomically updates + returns exactly one row.
 */
export class PostgresReliableWorkerQueue
  implements JobQueue {
  private readonly visibilityTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: (attempt: number) => number;

  constructor(
    private readonly db: PgQueryable,
    private readonly directory: WorkerDirectory,
    options: ReliableQueueOptions = {}
  ) {
    this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.backoffMs = options.backoffMs ?? (
      attempt => Math.min(60_000, 100 * 2 ** Math.max(0, attempt - 1))
    );
  }

  async migrate() {
    await this.db.query(
      POSTGRES_RELIABLE_QUEUE_SCHEMA
    );
  }

  async dispatch(job: RoutedResumeJob) {
    const now = Date.now();

    await this.db.query(`
      INSERT INTO uair_routed_jobs (
        job_id, execution_id, assigned_worker_id, job_json,
        state, attempt, max_attempts, available_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, 'queued', 0, $5, $6, $6, $6)
    `, [
      `job_${randomUUID()}`,
      job.executionId,
      job.workerId || null,
      JSON.stringify(job),
      this.maxAttempts,
      now
    ]);
  }

  async list() {
    const result = await this.db.query(`
      SELECT * FROM uair_routed_jobs
      ORDER BY created_at, job_id
    `);

    return result.rows.map(decodeRecord);
  }

  async deadLetters() {
    const result = await this.db.query(`
      SELECT * FROM uair_routed_jobs
      WHERE state = 'dead'
      ORDER BY updated_at, job_id
    `);

    return result.rows.map(decodeRecord);
  }

  async requeueDead(
    jobId: string,
    options: {
      resetAttempts?: boolean;
      now?: number;
    } = {}
  ) {
    const now =
      options.now ??
      Date.now();

    const result =
      await this.db.query(`
        UPDATE uair_routed_jobs
        SET state = 'queued',
            attempt =
              CASE
                WHEN $1
                THEN 0
                ELSE attempt
              END,
            assigned_worker_id = NULL,
            job_json =
              job_json ||
              jsonb_build_object('workerId', ''),
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            available_at = $2,
            updated_at = $2
        WHERE job_id = $3
          AND state = 'dead'
        RETURNING job_id
      `, [
        options.resetAttempts ===
          true,
        now,
        jobId
      ]);

    return Boolean(
      result.rows[0]
    );
  }

  async claim(
    workerId: string,
    now = Date.now()
  ) {
    // Expired leases are reclaimed independently; claim itself stays a
    // single atomic SQL statement, so no scheduler leader is required.
    const leaseToken = `lease_${randomUUID()}`;
    const expiresAt = now + this.visibilityTimeoutMs;

    const result = await this.db.query(`
      WITH candidate AS (
        SELECT job_id
        FROM uair_routed_jobs
        WHERE state = 'queued'
          AND assigned_worker_id = $1
          AND available_at <= $2
        ORDER BY available_at, created_at, job_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE uair_routed_jobs AS jobs
      SET state = 'leased',
          attempt = jobs.attempt + 1,
          lease_owner = $1,
          lease_token = $3,
          lease_expires_at = $4,
          updated_at = $2
      FROM candidate
      WHERE jobs.job_id = candidate.job_id
      RETURNING jobs.*
    `, [workerId, now, leaseToken, expiresAt]);

    const row = result.rows[0];
    if (!row) return null;

    this.directory.incrementQueue(workerId, -1);
    this.directory.incrementActive(workerId, 1);
    return decodeRecord(row);
  }

  async ack(jobId: string, leaseToken: string, now = Date.now()) {
    const result = await this.db.query<any>(`
      DELETE FROM uair_routed_jobs
      WHERE job_id = $1
        AND state = 'leased'
        AND lease_token = $2
        AND lease_expires_at >= $3
      RETURNING assigned_worker_id, job_json
    `, [jobId, leaseToken, now]);

    const row = result.rows[0];
    if (!row) throw new InvalidJobLeaseError(jobId);

    const job = typeof row.job_json === 'string' ? JSON.parse(row.job_json) : row.job_json;
    this.directory.incrementActive(job.workerId, -1);
  }

  async nack(
    jobId: string,
    leaseToken: string,
    reason: string,
    now = Date.now()
  ) {
    const record = await this.requireLease(jobId, leaseToken, now);
    this.directory.incrementActive(record.job.workerId, -1);
    await this.retryOrDead(record, reason, now);
  }

  async extendLease(jobId: string, leaseToken: string, now = Date.now()) {
    const expiresAt = now + this.visibilityTimeoutMs;
    const result = await this.db.query(`
      UPDATE uair_routed_jobs
      SET lease_expires_at = $1,
          updated_at = $2
      WHERE job_id = $3
        AND state = 'leased'
        AND lease_token = $4
        AND lease_expires_at >= $2
      RETURNING job_id
    `, [expiresAt, now, jobId, leaseToken]);

    if (!result.rows[0]) throw new InvalidJobLeaseError(jobId);
    return expiresAt;
  }

  async reclaimExpired(now = Date.now()) {
    const result = await this.db.query<any>(`
      WITH expired AS (
        SELECT job_id, lease_owner AS previous_lease_owner
        FROM uair_routed_jobs
        WHERE state = 'leased'
          AND lease_expires_at <= $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE uair_routed_jobs AS jobs
      SET state = CASE
            WHEN jobs.attempt >= jobs.max_attempts THEN 'dead'
            ELSE 'queued'
          END,
          assigned_worker_id = CASE
            WHEN jobs.attempt >= jobs.max_attempts THEN jobs.assigned_worker_id
            ELSE NULL
          END,
          job_json = CASE
            WHEN jobs.attempt >= jobs.max_attempts THEN jobs.job_json
            ELSE jobs.job_json || jsonb_build_object('workerId', '')
          END,
          available_at = CASE
            WHEN jobs.attempt >= jobs.max_attempts THEN jobs.available_at
            ELSE $1
          END,
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = 'visibility timeout',
          updated_at = $1
      FROM expired
      WHERE jobs.job_id = expired.job_id
      RETURNING jobs.*, expired.previous_lease_owner
    `, [now]);

    for (const row of result.rows) {
      if (row.previous_lease_owner) {
        this.directory.incrementActive(
          String(row.previous_lease_owner),
          -1
        );
      }
    }

    return result.rows.length;
  }

  async reclaimWorker(workerId: string, now = Date.now()) {
    const result = await this.db.query(`
      UPDATE uair_routed_jobs
      SET state = CASE
            WHEN attempt >= max_attempts THEN 'dead'
            ELSE 'queued'
          END,
          assigned_worker_id = CASE
            WHEN attempt >= max_attempts THEN assigned_worker_id
            ELSE NULL
          END,
          job_json = CASE
            WHEN attempt >= max_attempts THEN job_json
            ELSE job_json || jsonb_build_object('workerId', '')
          END,
          available_at = CASE
            WHEN attempt >= max_attempts THEN available_at
            ELSE $2
          END,
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = 'worker reclaimed',
          updated_at = $2
      WHERE state = 'leased'
        AND lease_owner = $1
      RETURNING *
    `, [workerId, now]);

    for (const _ of result.rows) {
      this.directory.incrementActive(workerId, -1);
    }

    return result.rows.length;
  }

  async unassigned(now = Date.now()) {
    const result = await this.db.query<any>(`
      SELECT *
      FROM uair_routed_jobs
      WHERE state = 'queued'
        AND (assigned_worker_id IS NULL OR assigned_worker_id = '')
        AND available_at <= $1
      ORDER BY available_at, created_at, job_id
    `, [now]);

    return result.rows.map(
      decodeRecord
    );
  }

  async assign(
    jobId: string,
    workerId: string,
    now = Date.now()
  ) {
    const current = await this.db.query<any>(`
      SELECT job_json
      FROM uair_routed_jobs
      WHERE job_id = $1
    `, [jobId]);

    const row = current.rows[0];
    if (!row) return false;

    const job =
      typeof row.job_json === 'string'
        ? JSON.parse(row.job_json)
        : row.job_json;

    job.workerId = workerId;

    const result = await this.db.query(`
      UPDATE uair_routed_jobs
      SET assigned_worker_id = $1,
          job_json = $2::jsonb,
          updated_at = $3
      WHERE job_id = $4
        AND state = 'queued'
        AND (assigned_worker_id IS NULL OR assigned_worker_id = '')
        AND available_at <= $3
      RETURNING job_id
    `, [workerId, JSON.stringify(job), now, jobId]);

    return !!result.rows[0];
  }

  async routePending(now = Date.now()) {
    const result = await this.db.query(`
      SELECT * FROM uair_routed_jobs
      WHERE state = 'queued'
        AND (assigned_worker_id IS NULL OR assigned_worker_id = '')
        AND available_at <= $1
      ORDER BY available_at, created_at, job_id
    `, [now]);

    let count = 0;

    for (const row of result.rows) {
      const record = decodeRecord(row);

      try {
        const selected = this.directory.select(record.job.route, {
          intent: 'resume',
          now
        });

        record.job.workerId = selected.worker.workerId;

        const changed = await this.db.query(`
          UPDATE uair_routed_jobs
          SET assigned_worker_id = $1,
              job_json = $2::jsonb,
              updated_at = $3
          WHERE job_id = $4
            AND state = 'queued'
            AND (assigned_worker_id IS NULL OR assigned_worker_id = '')
          RETURNING job_id
        `, [
          record.job.workerId,
          JSON.stringify(record.job),
          now,
          record.jobId
        ]);

        if (changed.rows[0]) {
          this.directory.incrementQueue(record.job.workerId, 1);
          count += 1;
        }
      } catch (error) {
        if (!(error instanceof NoCompatibleWorkerError)) throw error;
      }
    }

    return count;
  }

  private async requireLease(jobId: string, leaseToken: string, now: number) {
    const result = await this.db.query(`
      SELECT * FROM uair_routed_jobs
      WHERE job_id = $1
        AND state = 'leased'
        AND lease_token = $2
        AND lease_expires_at >= $3
    `, [jobId, leaseToken, now]);

    if (!result.rows[0]) throw new InvalidJobLeaseError(jobId);
    return decodeRecord(result.rows[0]);
  }

  private async retryOrDead(record: ReliableJobRecord, reason: string, now: number) {
    if (record.attempt >= record.maxAttempts) {
      await this.db.query(`
        UPDATE uair_routed_jobs
        SET state = 'dead',
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = $1,
            updated_at = $2
        WHERE job_id = $3
      `, [reason, now, record.jobId]);
      return;
    }

    let workerId = '';
    try {
      workerId = this.directory.select(record.job.route, {
        intent: 'resume', now
      }).worker.workerId;
    } catch (error) {
      if (!(error instanceof NoCompatibleWorkerError)) throw error;
    }

    record.job.workerId = workerId;
    const availableAt = now + this.backoffMs(record.attempt);

    await this.db.query(`
      UPDATE uair_routed_jobs
      SET assigned_worker_id = $1,
          job_json = $2::jsonb,
          state = 'queued',
          available_at = $3,
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = $4,
          updated_at = $5
      WHERE job_id = $6
    `, [
      workerId || null,
      JSON.stringify(record.job),
      availableAt,
      reason,
      now,
      record.jobId
    ]);

    if (workerId) this.directory.incrementQueue(workerId, 1);
  }
}

export const POSTGRES_WORKER_REGISTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS uair_worker_registry (
  worker_id TEXT PRIMARY KEY,
  capabilities_json JSONB NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'draining', 'offline')),
  capacity DOUBLE PRECISION NOT NULL,
  queue_depth INTEGER NOT NULL,
  active_jobs INTEGER NOT NULL,
  last_heartbeat_at BIGINT NOT NULL,
  heartbeat_lease_ms BIGINT NOT NULL,
  metadata_json JSONB,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uair_worker_registry_heartbeat
ON uair_worker_registry(last_heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_uair_worker_registry_lifecycle
ON uair_worker_registry(lifecycle);
`;

export class PostgresWorkerRegistry {
  constructor(
    private readonly db: PgQueryable
  ) {}

  async migrate() {
    await this.db.query(
      POSTGRES_WORKER_REGISTRY_SCHEMA
    );
  }

  async register(
    worker: import("@uair/core/cluster").WorkerRegistration,
    now = Date.now()
  ) {
    const lifecycle =
      worker.healthy === false
        ? "offline"
        : worker.lifecycle ??
          "active";

    await this.db.query(`
      INSERT INTO uair_worker_registry (
        worker_id,
        capabilities_json,
        lifecycle,
        capacity,
        queue_depth,
        active_jobs,
        last_heartbeat_at,
        heartbeat_lease_ms,
        metadata_json,
        updated_at
      ) VALUES (
        $1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, $10
      )
      ON CONFLICT(worker_id)
      DO UPDATE SET
        capabilities_json = EXCLUDED.capabilities_json,
        lifecycle = EXCLUDED.lifecycle,
        capacity = EXCLUDED.capacity,
        queue_depth = EXCLUDED.queue_depth,
        active_jobs = EXCLUDED.active_jobs,
        last_heartbeat_at = EXCLUDED.last_heartbeat_at,
        heartbeat_lease_ms = EXCLUDED.heartbeat_lease_ms,
        metadata_json = EXCLUDED.metadata_json,
        updated_at = EXCLUDED.updated_at
    `, [
      worker.workerId,
      JSON.stringify(worker.capabilities),
      lifecycle,
      worker.capacity ?? Number.MAX_SAFE_INTEGER,
      worker.queueDepth ?? 0,
      worker.activeJobs ?? 0,
      worker.lastHeartbeatAt ?? now,
      worker.heartbeatLeaseMs ?? 30_000,
      worker.metadata == null
        ? null
        : JSON.stringify(worker.metadata),
      now
    ]);
  }

  async heartbeat(
    workerId: string,
    patch: Partial<
      Pick<
        import("@uair/core/cluster").WorkerRegistration,
        | "queueDepth"
        | "activeJobs"
        | "capacity"
        | "lifecycle"
        | "metadata"
      >
    > = {},
    now = Date.now()
  ) {
    const current = await this.db.query<any>(`
      SELECT *
      FROM uair_worker_registry
      WHERE worker_id = $1
    `, [workerId]);

    const row = current.rows[0];

    if (!row) {
      throw new Error(
        `Worker not registered: ${workerId}`
      );
    }

    await this.db.query(`
      UPDATE uair_worker_registry
      SET lifecycle = $1,
          capacity = $2,
          queue_depth = $3,
          active_jobs = $4,
          metadata_json = $5::jsonb,
          last_heartbeat_at = $6,
          updated_at = $6
      WHERE worker_id = $7
    `, [
      patch.lifecycle ?? row.lifecycle,
      patch.capacity ?? Number(row.capacity),
      patch.queueDepth ?? Number(row.queue_depth),
      patch.activeJobs ?? Number(row.active_jobs),
      patch.metadata === undefined
        ? (
            row.metadata_json == null
              ? null
              : JSON.stringify(row.metadata_json)
          )
        : JSON.stringify(patch.metadata),
      now,
      workerId
    ]);
  }

  async setLifecycle(
    workerId: string,
    lifecycle: import("@uair/core/cluster").WorkerLifecycle,
    now = Date.now()
  ) {
    const result = await this.db.query(`
      UPDATE uair_worker_registry
      SET lifecycle = $1,
          updated_at = $2
      WHERE worker_id = $3
      RETURNING worker_id
    `, [lifecycle, now, workerId]);

    if (!result.rows[0]) {
      throw new Error(
        `Worker not registered: ${workerId}`
      );
    }
  }

  async remove(workerId: string) {
    await this.db.query(`
      DELETE FROM uair_worker_registry
      WHERE worker_id = $1
    `, [workerId]);
  }

  async list(_now = Date.now()) {
    const result = await this.db.query<any>(`
      SELECT *
      FROM uair_worker_registry
      ORDER BY worker_id
    `);

    return result.rows.map(row => ({
      workerId: String(row.worker_id),
      capabilities:
        typeof row.capabilities_json === "string"
          ? JSON.parse(row.capabilities_json)
          : row.capabilities_json,
      lifecycle: row.lifecycle,
      capacity: Number(row.capacity),
      queueDepth: Number(row.queue_depth),
      activeJobs: Number(row.active_jobs),
      lastHeartbeatAt: Number(row.last_heartbeat_at),
      heartbeatLeaseMs: Number(row.heartbeat_lease_ms),
      metadata:
        row.metadata_json == null
          ? undefined
          : (
              typeof row.metadata_json === "string"
                ? JSON.parse(row.metadata_json)
                : row.metadata_json
            )
    }));
  }

  async reserveCapacity(
    route: import("@uair/core/cluster").ExecutionRoute,
    options: {
      intent?: import("@uair/core/cluster").RoutingIntent;
      now?: number;
    } = {}
  ): Promise<import("@uair/core/cluster").CapacityReservation> {
    const now = options.now ?? Date.now();
    const intent = options.intent ?? "resume";

    const result = await this.db.query<any>(`
      WITH candidate AS (
        SELECT worker_id
        FROM uair_worker_registry
        WHERE lifecycle <> 'offline'
          AND ($5::text <> 'new' OR lifecycle = 'active')
          AND $4 - last_heartbeat_at <= heartbeat_lease_ms
          AND queue_depth + active_jobs < capacity
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(capabilities_json) AS cap
            WHERE cap->>'workflow' = $1
              AND cap->>'workflowVersion' = $2
              AND ($3::text IS NULL OR cap->>'deploymentId' = $3)
              AND ($6::text IS NULL OR cap->>'workflowFingerprint' = $6)
          )
        ORDER BY
          (queue_depth + active_jobs) / GREATEST(capacity, 1),
          worker_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE uair_worker_registry AS workers
      SET queue_depth = workers.queue_depth + 1,
          updated_at = $4
      FROM candidate
      WHERE workers.worker_id = candidate.worker_id
        AND workers.queue_depth + workers.active_jobs < workers.capacity
      RETURNING workers.worker_id
    `, [
      route.workflow,
      route.workflowVersion,
      route.deploymentId ?? null,
      now,
      intent,
      route.workflowFingerprint ?? null
    ]);

    const row = result.rows[0];

    if (!row) {
      throw new NoCompatibleWorkerError(
        route,
        intent
      );
    }

    return {
      workerId: String(row.worker_id),
      route,
      intent,
      reservedAt: now
    };
  }

  async releaseCapacity(
    reservation: import("@uair/core/cluster").CapacityReservation,
    now = Date.now()
  ) {
    await this.db.query(`
      UPDATE uair_worker_registry
      SET queue_depth = GREATEST(queue_depth - 1, 0),
          updated_at = $1
      WHERE worker_id = $2
    `, [
      now,
      reservation.workerId
    ]);
  }

}


export {
  PostgresRuntimeState,
  PostgresRuntimeSchemaTooNewError,
  POSTGRES_RUNTIME_SCHEMA,
  POSTGRES_RUNTIME_SCHEMA_VERSION
} from "./postgres-runtime-state.js";

export type {
  PgClientLike,
  PgPoolLike
} from "./postgres-runtime-state.js";
