import {
  WorkerDirectory,
  LeaderlessQueueScheduler
} from "@uair/core/cluster";
import {
  SqliteReliableWorkerQueue
} from "@uair/sqlite";
import {
  writeFile
} from "node:fs/promises";

const [file, output, nowRaw] = process.argv.slice(2);
const now = Number(nowRaw);

const directory = new WorkerDirectory()
  .register({
    workerId: "worker-shared",
    capacity: 10,
    queueDepth: 0,
    activeJobs: 1,
    lastHeartbeatAt: now,
    heartbeatLeaseMs: 60_000,
    capabilities: []
  });

const queue = new SqliteReliableWorkerQueue(
  file,
  directory,
  {
    visibilityTimeoutMs: 30,
    maxAttempts: 3,
    backoffMs: () => 0
  }
);

try {
  const scheduler = new LeaderlessQueueScheduler(queue);
  const result = await scheduler.tick(now);
  await writeFile(output, JSON.stringify(result));
} finally {
  queue.close();
}
