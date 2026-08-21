import {
  DatabaseSync
} from "node:sqlite";
import {
  dirname
} from "node:path";
import {
  mkdirSync
} from "node:fs";
import {
  randomUUID
} from "node:crypto";
import {
  WorkerDirectory,
  NoCompatibleWorkerError,
  InvalidJobLeaseError,
  type RoutedResumeJob,
  type WorkerDispatcher,
  type ReliableJobRecord,
  type ReliableQueueOptions,
  type JobQueue
} from "@uair/core/cluster";

function decodeRecord(
  row: any
): ReliableJobRecord {
  const job =
    JSON.parse(
      String(row.job_json)
    ) as RoutedResumeJob;

  return {
    jobId:
      String(row.job_id),
    job,
    state:
      row.state,
    attempt:
      Number(row.attempt),
    maxAttempts:
      Number(row.max_attempts),
    availableAt:
      Number(row.available_at),
    leaseOwner:
      row.lease_owner == null
        ? undefined
        : String(
            row.lease_owner
          ),
    leaseToken:
      row.lease_token == null
        ? undefined
        : String(
            row.lease_token
          ),
    leaseExpiresAt:
      row.lease_expires_at == null
        ? undefined
        : Number(
            row.lease_expires_at
          ),
    lastError:
      row.last_error == null
        ? undefined
        : String(
            row.last_error
          ),
    createdAt:
      Number(row.created_at),
    updatedAt:
      Number(row.updated_at)
  };
}

/**
 * Durable SQLite implementation of reliable routed-job semantics.
 * Queue state survives scheduler/worker process restarts.
 */
export class SqliteReliableWorkerQueue
  implements JobQueue {
  readonly db: DatabaseSync;

  private readonly visibilityTimeoutMs:
    number;

  private readonly maxAttempts:
    number;

  private readonly backoffMs:
    (
      attempt: number
    ) => number;

  constructor(
    readonly file:
      string,
    private readonly directory:
      WorkerDirectory,
    options:
      ReliableQueueOptions = {}
  ) {
    mkdirSync(
      dirname(file),
      {
        recursive: true
      }
    );

    this.db =
      new DatabaseSync(file);

    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS routed_jobs (
        job_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        assigned_worker_id TEXT,
        job_json TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        available_at INTEGER NOT NULL,
        lease_owner TEXT,
        lease_token TEXT,
        lease_expires_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_routed_jobs_claim
      ON routed_jobs(state, assigned_worker_id, available_at, created_at);

      CREATE INDEX IF NOT EXISTS idx_routed_jobs_lease
      ON routed_jobs(state, lease_expires_at);
    `);

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

  close() {
    this.db.close();
  }

  async dispatch(
    job: RoutedResumeJob
  ) {
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO routed_jobs (
        job_id,
        execution_id,
        assigned_worker_id,
        job_json,
        state,
        attempt,
        max_attempts,
        available_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)
    `).run(
      `job_${randomUUID()}`,
      job.executionId,
      job.workerId,
      JSON.stringify(job),
      this.maxAttempts,
      now,
      now,
      now
    );
  }

  list() {
    return this.db.prepare(`
      SELECT *
      FROM routed_jobs
      ORDER BY created_at, job_id
    `).all().map(
      decodeRecord
    );
  }

  deadLetters() {
    return this.db.prepare(`
      SELECT *
      FROM routed_jobs
      WHERE state = 'dead'
      ORDER BY updated_at, job_id
    `).all().map(
      decodeRecord
    );
  }

  requeueDead(
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
      this.db.prepare(`
        UPDATE routed_jobs
        SET state = 'queued',
            attempt =
              CASE
                WHEN ?
                THEN 0
                ELSE attempt
              END,
            assigned_worker_id = NULL,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            available_at = ?,
            updated_at = ?
        WHERE job_id = ?
          AND state = 'dead'
      `).run(
        options.resetAttempts ===
          true
          ? 1
          : 0,
        now,
        now,
        jobId
      );

    return Number(
      result.changes
    ) === 1;
  }

  claim(
    workerId: string,
    now = Date.now()
  ) {
    this.reclaimExpired(now);

    this.db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const row: any =
        this.db.prepare(`
          SELECT *
          FROM routed_jobs
          WHERE state = 'queued'
            AND assigned_worker_id = ?
            AND available_at <= ?
          ORDER BY available_at, created_at, job_id
          LIMIT 1
        `).get(
          workerId,
          now
        );

      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }

      const leaseToken =
        `lease_${randomUUID()}`;

      const expiresAt =
        now +
        this.visibilityTimeoutMs;

      const changed =
        this.db.prepare(`
          UPDATE routed_jobs
          SET state = 'leased',
              attempt = attempt + 1,
              lease_owner = ?,
              lease_token = ?,
              lease_expires_at = ?,
              updated_at = ?
          WHERE job_id = ?
            AND state = 'queued'
        `).run(
          workerId,
          leaseToken,
          expiresAt,
          now,
          row.job_id
        );

      if (
        Number(changed.changes) !== 1
      ) {
        this.db.exec("ROLLBACK");
        return null;
      }

      const leased: any =
        this.db.prepare(`
          SELECT *
          FROM routed_jobs
          WHERE job_id = ?
        `).get(
          row.job_id
        );

      this.db.exec("COMMIT");

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

      return decodeRecord(
        leased
      );
    } catch (error) {
      try {
        this.db.exec(
          "ROLLBACK"
        );
      } catch {}

      throw error;
    }
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

    const result =
      this.db.prepare(`
        DELETE FROM routed_jobs
        WHERE job_id = ?
          AND state = 'leased'
          AND lease_token = ?
          AND lease_expires_at >= ?
      `).run(
        jobId,
        leaseToken,
        now
      );

    if (
      Number(result.changes) !== 1
    ) {
      throw new InvalidJobLeaseError(
        jobId
      );
    }

    this.directory
      .incrementActive(
        record.job.workerId,
        -1
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

    this.retryOrDead(
      record,
      reason,
      now
    );
  }

  extendLease(
    jobId: string,
    leaseToken: string,
    now = Date.now()
  ) {
    this.requireLease(
      jobId,
      leaseToken,
      now
    );

    const expiresAt =
      now +
      this.visibilityTimeoutMs;

    this.db.prepare(`
      UPDATE routed_jobs
      SET lease_expires_at = ?,
          updated_at = ?
      WHERE job_id = ?
        AND state = 'leased'
        AND lease_token = ?
    `).run(
      expiresAt,
      now,
      jobId,
      leaseToken
    );

    return expiresAt;
  }

  reclaimExpired(
    now = Date.now()
  ) {
    this.db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const rows =
        this.db.prepare(`
          SELECT *
          FROM routed_jobs
          WHERE state = 'leased'
            AND lease_expires_at <= ?
        `).all(
          now
        );

      for (const row of rows) {
        const record =
          decodeRecord(row);

        if (record.leaseOwner) {
          this.directory
            .incrementActive(
              record.leaseOwner,
              -1
            );
        }

        this.retryOrDead(
          record,
          "visibility timeout",
          now
        );
      }

      this.db.exec("COMMIT");
      return rows.length;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}

      throw error;
    }
  }

  reclaimWorker(
    workerId: string,
    now = Date.now()
  ) {
    const rows =
      this.db.prepare(`
        SELECT *
        FROM routed_jobs
        WHERE state = 'leased'
          AND lease_owner = ?
      `).all(
        workerId
      );

    for (const row of rows) {
      const record =
        decodeRecord(row);

      this.directory
        .incrementActive(
          workerId,
          -1
        );

      this.retryOrDead(
        record,
        "worker reclaimed",
        now
      );
    }

    return rows.length;
  }

  unassigned(
    now = Date.now()
  ) {
    return this.db.prepare(`
      SELECT *
      FROM routed_jobs
      WHERE state = 'queued'
        AND (
          assigned_worker_id IS NULL OR
          assigned_worker_id = ''
        )
        AND available_at <= ?
      ORDER BY available_at, created_at, job_id
    `).all(now).map(
      decodeRecord
    );
  }

  assign(
    jobId: string,
    workerId: string,
    now = Date.now()
  ) {
    const row: any =
      this.db.prepare(`
        SELECT *
        FROM routed_jobs
        WHERE job_id = ?
      `).get(jobId);

    if (!row) return false;

    const record = decodeRecord(row);
    record.job.workerId = workerId;

    const result =
      this.db.prepare(`
        UPDATE routed_jobs
        SET assigned_worker_id = ?,
            job_json = ?,
            updated_at = ?
        WHERE job_id = ?
          AND state = 'queued'
          AND (
            assigned_worker_id IS NULL OR
            assigned_worker_id = ''
          )
          AND available_at <= ?
      `).run(
        workerId,
        JSON.stringify(record.job),
        now,
        jobId,
        now
      );

    return Number(result.changes) === 1;
  }

  routePending(
    now = Date.now()
  ) {
    const rows =
      this.db.prepare(`
        SELECT *
        FROM routed_jobs
        WHERE state = 'queued'
          AND (
            assigned_worker_id IS NULL OR
            assigned_worker_id = ''
          )
          AND available_at <= ?
      `).all(
        now
      );

    let count = 0;

    for (const row of rows) {
      const record =
        decodeRecord(row);

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

        this.db.prepare(`
          UPDATE routed_jobs
          SET assigned_worker_id = ?,
              job_json = ?,
              updated_at = ?
          WHERE job_id = ?
            AND state = 'queued'
        `).run(
          record.job.workerId,
          JSON.stringify(
            record.job
          ),
          now,
          record.jobId
        );

        this.directory
          .incrementQueue(
            record.job.workerId,
            1
          );

        count += 1;
      } catch (error) {
        if (
          !(error instanceof
            NoCompatibleWorkerError)
        ) {
          throw error;
        }
      }
    }

    return count;
  }

  /**
   * Rebuild in-memory scheduler load after scheduler process restart.
   */
  reconcileDirectoryLoad() {
    const workers =
      this.directory.list();

    for (const worker of workers) {
      const queued: any =
        this.db.prepare(`
          SELECT COUNT(*) AS n
          FROM routed_jobs
          WHERE state = 'queued'
            AND assigned_worker_id = ?
        `).get(
          worker.workerId
        );

      const leased: any =
        this.db.prepare(`
          SELECT COUNT(*) AS n
          FROM routed_jobs
          WHERE state = 'leased'
            AND lease_owner = ?
        `).get(
          worker.workerId
        );

      this.directory.heartbeat(
        worker.workerId,
        {
          queueDepth:
            Number(
              queued?.n ?? 0
            ),
          activeJobs:
            Number(
              leased?.n ?? 0
            )
        }
      );
    }
  }

  private requireLease(
    jobId: string,
    leaseToken: string,
    now: number
  ) {
    const row: any =
      this.db.prepare(`
        SELECT *
        FROM routed_jobs
        WHERE job_id = ?
          AND state = 'leased'
          AND lease_token = ?
          AND lease_expires_at >= ?
      `).get(
        jobId,
        leaseToken,
        now
      );

    if (!row) {
      throw new InvalidJobLeaseError(
        jobId
      );
    }

    return decodeRecord(row);
  }

  private retryOrDead(
    record:
      ReliableJobRecord,
    reason: string,
    now: number
  ) {
    if (
      record.attempt >=
        record.maxAttempts
    ) {
      this.db.prepare(`
        UPDATE routed_jobs
        SET state = 'dead',
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = ?,
            updated_at = ?
        WHERE job_id = ?
      `).run(
        reason,
        now,
        record.jobId
      );

      return;
    }

    const workerId = "";

    // The routing projection must be cleared together with the durable
    // assigned-worker column. Otherwise load reconciliation sees an
    // unassigned retry as still queued on the dead/old worker and can
    // permanently consume shared capacity.
    record.job.workerId =
      workerId;

    const availableAt =
      now +
      this.backoffMs(
        record.attempt
      );

    this.db.prepare(`
      UPDATE routed_jobs
      SET assigned_worker_id = ?,
          job_json = ?,
          state = 'queued',
          available_at = ?,
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = ?,
          updated_at = ?
      WHERE job_id = ?
    `).run(
      workerId || null,
      JSON.stringify(
        record.job
      ),
      availableAt,
      reason,
      now,
      record.jobId
    );

    if (workerId) {
      this.directory
        .incrementQueue(
          workerId,
          1
        );
    }
  }
}
