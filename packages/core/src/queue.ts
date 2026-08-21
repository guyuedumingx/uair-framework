export type ResumeJob = {
  executionId: string;
  reason:
    | "event"
    | "timer"
    | "manual";
};

export interface ResumeQueue {
  enqueue(
    job: ResumeJob
  ): Promise<void>;

  drain():
    Promise<ResumeJob[]>;
}

export class InMemoryResumeQueue
  implements ResumeQueue {
  private jobs:
    ResumeJob[] = [];

  private dedupe =
    new Set<string>();

  async enqueue(
    job: ResumeJob
  ): Promise<void> {
    if (
      this.dedupe.has(
        job.executionId
      )
    ) {
      return;
    }

    this.dedupe.add(
      job.executionId
    );

    this.jobs.push(job);
  }

  async drain():
    Promise<ResumeJob[]> {
    const jobs =
      this.jobs.splice(0);

    for (const job of jobs) {
      this.dedupe.delete(
        job.executionId
      );
    }

    return jobs;
  }
}
