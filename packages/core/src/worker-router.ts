import type {
  Storage
} from "./storage.js";
import {
  resumeExecution
} from "./runtime.js";
import {
  VersionedWorkflowRegistry
} from "./versioning.js";
import {
  routeForExecution,
  WorkerDirectory,
  type ExecutionRoute,
  type WorkerRegistration
} from "./routing.js";
import type {
  ResumeJob
} from "./queue.js";

export type RoutedResumeJob =
  ResumeJob & {
    route:
      ExecutionRoute;
    workerId:
      string;
  };

export interface WorkerDispatcher {
  dispatch(
    job:
      RoutedResumeJob
  ): Promise<void>;
}

export class DeploymentRouter {
  constructor(
    private readonly storage:
      Storage,
    private readonly directory:
      WorkerDirectory,
    private readonly dispatcher:
      WorkerDispatcher
  ) {}

  async route(
    job: ResumeJob
  ) {
    const execution =
      await this.storage
        .loadExecution(
          job.executionId
        );

    if (!execution) {
      throw new Error(
        `Execution not found: ${job.executionId}`
      );
    }

    const route =
      routeForExecution(
        execution
      );

    const selected =
      this.directory.select(
        route,
        {
          intent: "resume"
        }
      );

    const routed:
      RoutedResumeJob = {
      ...job,
      route,
      workerId:
        selected.worker
          .workerId
    };

    this.directory
      .incrementQueue(
        routed.workerId,
        1
      );

    try {
      await this.dispatcher
        .dispatch(
          routed
        );
    } catch (error) {
      this.directory
        .incrementQueue(
          routed.workerId,
          -1
        );

      throw error;
    }

    return routed;
  }

  selectForNewExecution(
    route:
      ExecutionRoute
  ) {
    return this.directory.select(
      route,
      {
        intent: "new"
      }
    );
  }

  async routeMany(
    jobs:
      ResumeJob[]
  ) {
    const routed:
      RoutedResumeJob[] = [];

    for (const job of jobs) {
      routed.push(
        await this.route(
          job
        )
      );
    }

    return routed;
  }
}

export class InMemoryWorkerDispatcher
  implements WorkerDispatcher {
  readonly jobs =
    new Map<
      string,
      RoutedResumeJob[]
    >();

  async dispatch(
    job:
      RoutedResumeJob
  ) {
    const queue =
      this.jobs.get(
        job.workerId
      ) ?? [];

    queue.push(job);

    this.jobs.set(
      job.workerId,
      queue
    );
  }

  drain(
    workerId: string
  ) {
    const jobs =
      this.jobs.get(
        workerId
      ) ?? [];

    this.jobs.delete(
      workerId
    );

    return jobs;
  }
}


export class RoutedWorker {
  constructor(
    readonly registration:
      WorkerRegistration,
    private readonly storage:
      Storage,
    private readonly workflows:
      VersionedWorkflowRegistry,
    private readonly directory?:
      WorkerDirectory
  ) {}

  async handle(
    job:
      RoutedResumeJob
  ) {
    if (
      job.workerId !==
        this.registration.workerId
    ) {
      throw new Error(
        `Job ${job.executionId} routed to ${job.workerId}, not ${this.registration.workerId}`
      );
    }

    const execution =
      await this.storage
        .loadExecution(
          job.executionId
        );

    if (!execution) {
      throw new Error(
        `Execution not found: ${job.executionId}`
      );
    }

    const currentRoute =
      routeForExecution(
        execution
      );

    if (
      currentRoute.workflow !==
        job.route.workflow ||
      currentRoute.workflowVersion !==
        job.route.workflowVersion ||
      currentRoute.deploymentId !==
        job.route.deploymentId ||
      currentRoute.workflowFingerprint !==
        job.route.workflowFingerprint
    ) {
      throw new Error(
        `Execution route changed before worker handling: ${job.executionId}`
      );
    }

    const workflow =
      this.workflows
        .resolveExecution(
          execution
        );

    if (!workflow) {
      throw new Error(
        `Worker ${this.registration.workerId} does not have ` +
        `${execution.workflow}@${execution.workflowVersion ?? "1"}`
      );
    }

    const capability =
      this.registration
        .capabilities
        .find(
          item =>
            item.workflow ===
              currentRoute.workflow &&
            item.workflowVersion ===
              currentRoute.workflowVersion &&
            item.deploymentId ===
              currentRoute.deploymentId &&
            item.workflowFingerprint ===
              currentRoute.workflowFingerprint
        );

    if (!capability) {
      throw new Error(
        `Worker ${this.registration.workerId} registration does not match routed execution identity`
      );
    }

    this.directory
      ?.incrementQueue(
        this.registration.workerId,
        -1
      );

    this.directory
      ?.incrementActive(
        this.registration.workerId,
        1
      );

    try {
      return await resumeExecution(
        workflow,
        execution.id,
        this.storage
      );
    } finally {
      this.directory
        ?.incrementActive(
          this.registration.workerId,
          -1
        );
    }
  }
}
