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
  WorkerDirectory,
  NoCompatibleWorkerError,
  type SharedWorkerRegistry,
  type WorkerRegistration,
  type WorkerLifecycle,
  type ExecutionRoute,
  type RoutingIntent,
  type CapacityReservation
} from "@uair/core/cluster";

function decodeWorker(
  row: any
): WorkerRegistration {
  return {
    workerId:
      String(row.worker_id),
    capabilities:
      JSON.parse(
        String(
          row.capabilities_json
        )
      ),
    lifecycle:
      row.lifecycle as
        WorkerLifecycle,
    capacity:
      Number(row.capacity),
    queueDepth:
      Number(row.queue_depth),
    activeJobs:
      Number(row.active_jobs),
    lastHeartbeatAt:
      Number(
        row.last_heartbeat_at
      ),
    heartbeatLeaseMs:
      Number(
        row.heartbeat_lease_ms
      ),
    metadata:
      row.metadata_json == null
        ? undefined
        : JSON.parse(
            String(
              row.metadata_json
            )
          )
  };
}

export class SqliteWorkerRegistry
  implements SharedWorkerRegistry {
  readonly db: DatabaseSync;

  constructor(
    readonly file: string
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
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS worker_registry (
        worker_id TEXT PRIMARY KEY,
        capabilities_json TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        capacity REAL NOT NULL,
        queue_depth INTEGER NOT NULL,
        active_jobs INTEGER NOT NULL,
        last_heartbeat_at INTEGER NOT NULL,
        heartbeat_lease_ms INTEGER NOT NULL,
        metadata_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_worker_registry_heartbeat
      ON worker_registry(last_heartbeat_at);

      CREATE INDEX IF NOT EXISTS idx_worker_registry_lifecycle
      ON worker_registry(lifecycle);
    `);
  }

  register(
    worker: WorkerRegistration,
    now = Date.now()
  ) {
    const lifecycle =
      worker.healthy === false
        ? "offline"
        : worker.lifecycle ??
          "active";

    this.db.prepare(`
      INSERT INTO worker_registry (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(worker_id)
      DO UPDATE SET
        capabilities_json = excluded.capabilities_json,
        lifecycle = excluded.lifecycle,
        capacity = excluded.capacity,
        queue_depth = excluded.queue_depth,
        active_jobs = excluded.active_jobs,
        last_heartbeat_at = excluded.last_heartbeat_at,
        heartbeat_lease_ms = excluded.heartbeat_lease_ms,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      worker.workerId,
      JSON.stringify(
        worker.capabilities
      ),
      lifecycle,
      worker.capacity ??
        Number.MAX_SAFE_INTEGER,
      worker.queueDepth ?? 0,
      worker.activeJobs ?? 0,
      worker.lastHeartbeatAt ?? now,
      worker.heartbeatLeaseMs ??
        30_000,
      worker.metadata == null
        ? null
        : JSON.stringify(
            worker.metadata
          ),
      now
    );
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
        | "metadata"
      >
    > = {},
    now = Date.now()
  ) {
    const current: any =
      this.db.prepare(`
        SELECT *
        FROM worker_registry
        WHERE worker_id = ?
      `).get(workerId);

    if (!current) {
      throw new Error(
        `Worker not registered: ${workerId}`
      );
    }

    this.db.prepare(`
      UPDATE worker_registry
      SET lifecycle = ?,
          capacity = ?,
          queue_depth = ?,
          active_jobs = ?,
          metadata_json = ?,
          last_heartbeat_at = ?,
          updated_at = ?
      WHERE worker_id = ?
    `).run(
      patch.lifecycle ??
        current.lifecycle,
      patch.capacity ??
        Number(
          current.capacity
        ),
      patch.queueDepth ??
        Number(
          current.queue_depth
        ),
      patch.activeJobs ??
        Number(
          current.active_jobs
        ),
      patch.metadata ===
        undefined
        ? current.metadata_json
        : JSON.stringify(
            patch.metadata
          ),
      now,
      now,
      workerId
    );
  }

  setLifecycle(
    workerId: string,
    lifecycle:
      WorkerLifecycle,
    now = Date.now()
  ) {
    const result =
      this.db.prepare(`
        UPDATE worker_registry
        SET lifecycle = ?,
            updated_at = ?
        WHERE worker_id = ?
      `).run(
        lifecycle,
        now,
        workerId
      );

    if (
      Number(
        result.changes
      ) !== 1
    ) {
      throw new Error(
        `Worker not registered: ${workerId}`
      );
    }
  }

  remove(
    workerId: string
  ) {
    this.db.prepare(`
      DELETE FROM worker_registry
      WHERE worker_id = ?
    `).run(workerId);
  }

  list(
    _now = Date.now()
  ) {
    return this.db
      .prepare(`
        SELECT *
        FROM worker_registry
        ORDER BY worker_id
      `)
      .all()
      .map(decodeWorker);
  }

  reserveCapacity(
    route: ExecutionRoute,
    options: {
      intent?: RoutingIntent;
      now?: number;
    } = {}
  ): CapacityReservation {
    const now =
      options.now ?? Date.now();

    this.db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const workers =
        this.db.prepare(`
          SELECT *
          FROM worker_registry
          ORDER BY worker_id
        `).all().map(
          decodeWorker
        );

      const directory =
        new WorkerDirectory();

      for (const worker of workers) {
        directory.register(worker);
      }

      const selected =
        directory.select(
          route,
          {
            intent:
              options.intent,
            now
          }
        );

      const result =
        this.db.prepare(`
          UPDATE worker_registry
          SET queue_depth = queue_depth + 1,
              updated_at = ?
          WHERE worker_id = ?
            AND queue_depth + active_jobs < capacity
        `).run(
          now,
          selected.worker.workerId
        );

      if (
        Number(
          result.changes
        ) !== 1
      ) {
        throw new NoCompatibleWorkerError(
          route,
          options.intent ??
            "resume"
        );
      }

      this.db.exec("COMMIT");

      return {
        workerId:
          selected.worker.workerId,
        route,
        intent:
          options.intent ??
          "resume",
        reservedAt: now
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  releaseCapacity(
    reservation:
      CapacityReservation,
    now = Date.now()
  ) {
    this.db.prepare(`
      UPDATE worker_registry
      SET queue_depth =
            CASE
              WHEN queue_depth > 0
              THEN queue_depth - 1
              ELSE 0
            END,
          updated_at = ?
      WHERE worker_id = ?
    `).run(
      now,
      reservation.workerId
    );
  }

  close() {
    this.db.close();
  }
}
