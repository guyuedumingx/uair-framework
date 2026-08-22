import {
  randomUUID
} from "node:crypto";
import type { LockManager } from "@uair/core/adapter";
import {
  SqliteRuntimeState
} from "./sqlite-state.js";
import { runWithFence } from "@uair/core/adapter";

export type SqliteLeaseOptions = {
  leaseMs?: number;
  heartbeatMs?: number;
  retryMs?: number;

  /**
   * Test-only escape hatch used to prove stale workers are fenced.
   */
  disableHeartbeat?: boolean;
};

export class SqliteLeaseLockManager
  implements LockManager {
  private readonly leaseMs:
    number;

  private readonly heartbeatMs:
    number;

  private readonly retryMs:
    number;

  private readonly disableHeartbeat:
    boolean;

  constructor(
    private readonly state:
      SqliteRuntimeState,
    options:
      SqliteLeaseOptions = {}
  ) {
    this.leaseMs =
      options.leaseMs ??
      30_000;

    this.heartbeatMs =
      options.heartbeatMs ??
      Math.max(
        100,
        Math.floor(
          this.leaseMs / 3
        )
      );

    this.retryMs =
      options.retryMs ??
      10;

    this.disableHeartbeat =
      options.disableHeartbeat ??
      false;
  }

  private sleep(
    ms: number
  ) {
    return new Promise<void>(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );
  }

  private tryAcquire(
    key: string,
    owner: string
  ): number | null {
    const now =
      Date.now();

    this.state.db.exec(
      "BEGIN IMMEDIATE"
    );

    try {
      const current =
        this.state.db.prepare(`
          SELECT
            owner,
            fence_token,
            expires_at
          FROM runtime_locks
          WHERE lock_key = ?
        `).get(
          key
        ) as any;

      let token:
        number;

      if (!current) {
        token = 1;

        this.state.db.prepare(`
          INSERT INTO runtime_locks (
            lock_key,
            owner,
            fence_token,
            expires_at
          )
          VALUES (?, ?, ?, ?)
        `).run(
          key,
          owner,
          token,
          now + this.leaseMs
        );
      } else if (
        Number(
          current.expires_at
        ) <= now
      ) {
        token =
          Number(
            current.fence_token
          ) + 1;

        this.state.db.prepare(`
          UPDATE runtime_locks
          SET
            owner = ?,
            fence_token = ?,
            expires_at = ?
          WHERE lock_key = ?
        `).run(
          owner,
          token,
          now + this.leaseMs,
          key
        );
      } else if (
        String(
          current.owner
        ) === owner
      ) {
        token =
          Number(
            current.fence_token
          );

        this.state.db.prepare(`
          UPDATE runtime_locks
          SET expires_at = ?
          WHERE lock_key = ?
            AND owner = ?
            AND fence_token = ?
        `).run(
          now + this.leaseMs,
          key,
          owner,
          token
        );
      } else {
        this.state.db.exec(
          "ROLLBACK"
        );

        return null;
      }

      this.state.db.exec(
        "COMMIT"
      );

      return token;
    } catch (error) {
      this.state.db.exec(
        "ROLLBACK"
      );

      throw error;
    }
  }

  private renew(
    key: string,
    owner: string,
    token: number
  ): boolean {
    const result =
      this.state.db.prepare(`
        UPDATE runtime_locks
        SET expires_at = ?
        WHERE lock_key = ?
          AND owner = ?
          AND fence_token = ?
          AND expires_at > ?
      `).run(
        Date.now() +
          this.leaseMs,
        key,
        owner,
        token,
        Date.now()
      );

    return (
      Number(
        result.changes
      ) === 1
    );
  }

  private release(
    key: string,
    owner: string,
    token: number
  ) {
    this.state.db.prepare(`
      DELETE FROM runtime_locks
      WHERE lock_key = ?
        AND owner = ?
        AND fence_token = ?
    `).run(
      key,
      owner,
      token
    );
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const owner =
      randomUUID();

    let token:
      number | null = null;

    while (
      token === null
    ) {
      token =
        this.tryAcquire(
          key,
          owner
        );

      if (
        token === null
      ) {
        await this.sleep(
          this.retryMs
        );
      }
    }

    let heartbeat:
      ReturnType<
        typeof setInterval
      > | undefined;

    if (
      !this.disableHeartbeat
    ) {
      heartbeat =
        setInterval(
          () => {
            try {
              this.renew(
                key,
                owner,
                token!
              );
            } catch {
              // Commit-time fencing remains authoritative.
              // A failed heartbeat will eventually make writes fail.
            }
          },
          this.heartbeatMs
        );

      heartbeat.unref?.();
    }

    try {
      if (
        key.startsWith(
          "execution:"
        )
      ) {
        return await runWithFence(
          {
            lockKey: key,
            owner,
            token
          },
          fn
        );
      }

      return await fn();
    } finally {
      if (heartbeat) {
        clearInterval(
          heartbeat
        );
      }

      try {
        this.release(
          key,
          owner,
          token
        );
      } catch {
        // If ownership was already lost, release must not delete the
        // newer owner's row because owner+token are part of the WHERE.
      }
    }
  }
}
