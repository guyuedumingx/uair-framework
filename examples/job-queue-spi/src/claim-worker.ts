import {
  WorkerDirectory
} from "@uair/core/cluster";
import {
  SqliteReliableWorkerQueue
} from "@uair/sqlite";

const [file, output, startAtRaw] =
  process.argv.slice(2);

const startAt = Number(startAtRaw);

const directory =
  new WorkerDirectory()
    .register({
      workerId: "worker-shared",
      capacity: 10,
      queueDepth: 1,
      activeJobs: 0,
      lastHeartbeatAt: Date.now(),
      heartbeatLeaseMs: 60_000,
      capabilities: []
    });

while (Date.now() < startAt) {
  // synchronize two independent Node processes closely enough to race
}

const queue =
  new SqliteReliableWorkerQueue(
    file,
    directory,
    {
      visibilityTimeoutMs: 10_000
    }
  );

try {
  const claimed =
    queue.claim(
      "worker-shared"
    );

  await import("node:fs/promises")
    .then(({writeFile}) =>
      writeFile(
        output,
        JSON.stringify(
          claimed
            ? {
                jobId: claimed.jobId,
                leaseToken: claimed.leaseToken
              }
            : null
        )
      )
    );
} finally {
  queue.close();
}
