import {
  createHash
} from "node:crypto";
import type {
  Execution,
  WorkflowDefinition
} from "./types.js";

export function fingerprintWorkflow(
  workflow:
    WorkflowDefinition<any, any>
) {
  if (workflow.fingerprint) {
    return workflow.fingerprint;
  }

  const source =
    workflow.handler
      .toString()
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  return createHash(
    "sha256"
  )
    .update(
      JSON.stringify({
        name:
          workflow.name,
        version:
          workflow.version,
        source
      })
    )
    .digest("hex");
}

export type DeploymentManifest = {
  deploymentId: string;
  workflows: Array<{
    name: string;
    version: string;
    fingerprint: string;
  }>;
};

export function createDeploymentManifest(
  deploymentId: string,
  workflows:
    WorkflowDefinition<any, any>[]
): DeploymentManifest {
  return {
    deploymentId,
    workflows:
      workflows.map(
        workflow => ({
          name:
            workflow.name,
          version:
            workflow.version,
          fingerprint:
            fingerprintWorkflow(
              workflow
            )
        })
      )
  };
}

export class WorkflowFingerprintMismatchError
  extends Error {
  constructor(
    readonly workflowName:
      string,
    readonly version:
      string,
    readonly expected:
      string,
    readonly actual:
      string
  ) {
    super(
      `Workflow fingerprint mismatch for ` +
      `"${workflowName}" version "${version}". ` +
      `Expected ${expected}, got ${actual}.`
    );

    this.name =
      "WorkflowFingerprintMismatchError";
  }
}

export class ExecutionDeploymentMismatchError
  extends Error {
  constructor(
    readonly executionId:
      string,
    readonly workflowName:
      string,
    readonly version:
      string,
    readonly pinnedFingerprint:
      string,
    readonly runtimeFingerprint:
      string
  ) {
    super(
      `Execution ${executionId} is pinned to ` +
      `"${workflowName}"@${version} fingerprint ` +
      `${pinnedFingerprint}, but runtime has ${runtimeFingerprint}.`
    );

    this.name =
      "ExecutionDeploymentMismatchError";
  }
}

export function assertExecutionWorkflowIdentity(
  execution: Execution,
  workflow:
    WorkflowDefinition<any, any>
) {
  const pinned =
    execution
      .workflowFingerprint;

  if (!pinned) {
    return;
  }

  const actual =
    fingerprintWorkflow(
      workflow
    );

  if (pinned !== actual) {
    throw new ExecutionDeploymentMismatchError(
      execution.id,
      execution.workflow,
      execution.workflowVersion ??
        "1",
      pinned,
      actual
    );
  }
}


export function verifyDeploymentManifest(
  manifest:
    DeploymentManifest,
  workflows:
    WorkflowDefinition<any, any>[]
) {
  const actual =
    new Map(
      workflows.map(
        workflow => [
          `${workflow.name}@${workflow.version}`,
          fingerprintWorkflow(
            workflow
          )
        ]
      )
    );

  for (
    const expected
    of manifest.workflows
  ) {
    const key =
      `${expected.name}@${expected.version}`;

    const value =
      actual.get(key);

    if (!value) {
      throw new Error(
        `Deployment is missing workflow ${key}`
      );
    }

    if (
      value !==
      expected.fingerprint
    ) {
      throw new WorkflowFingerprintMismatchError(
        expected.name,
        expected.version,
        expected.fingerprint,
        value
      );
    }
  }

  return true;
}
