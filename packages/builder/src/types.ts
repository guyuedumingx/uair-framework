export type RequirementRequest = {
  description: string;
  companyScope?: string;
  packageName?: string;
};

export type ActorSpec = {
  id: string;
  label: string;
};

export type RuleSpec = {
  id: string;
  description: string;
};

export type CapabilityNeed = {
  id: string;
  description: string;
  required: boolean;
};

export type SurfaceNeed = {
  kind: string;
  purpose: string;
  blocking: boolean;
};

export type WorkflowNeed = {
  id: string;
  description: string;
  actors: string[];
  rules: string[];
  effects: string[];
};

export type BusinessSpec = {
  applicationId: string;
  name: string;
  packageName: string;
  actors: ActorSpec[];
  rules: RuleSpec[];
  capabilities: CapabilityNeed[];
  surfaces: SurfaceNeed[];
  workflows: WorkflowNeed[];
};


export type ProjectNodeKind =
  | "package"
  | "workflow"
  | "component"
  | "surface"
  | "capability";


export type ContractShape =
  | {
      kind:
        "unknown";
    }
  | {
      kind:
        "primitive";
      type:
        | "string"
        | "number"
        | "boolean"
        | "null"
        | "undefined";
    }
  | {
      kind:
        "literal";
      value:
        string |
        number |
        boolean |
        null;
    }
  | {
      kind:
        "array";
      element:
        ContractShape;
    }
  | {
      kind:
        "union";
      options:
        ContractShape[];
    }
  | {
      kind:
        "object";
      properties:
        Record<
          string,
          {
            required: boolean;
            shape:
              ContractShape;
          }
        >;
    };

export type NodeContract = {
  input?:
    ContractShape;
  output?:
    ContractShape;
  data?:
    ContractShape;
  action?:
    ContractShape;
};

export type ContractCompatibilityIssue = {
  severity:
    | "info"
    | "warning"
    | "error";
  code: string;
  message: string;
  kind:
    ProjectNodeKind;
  id: string;
  path?: string;
};

export type ContractCompatibilityReport = {
  compatible: boolean;
  issues:
    ContractCompatibilityIssue[];
  runtimePayloadChecks: Array<{
    surfaceKind: string;
    samples: number;
    compatible: boolean;
    issues: string[];
  }>;
};

export type ProjectGraphNode = {
  key: string;
  kind: ProjectNodeKind;
  id: string;
  packageName?: string;
  symbolName?: string;
  version?: string;
  file?: string;
  /**
   * Stable hash of the declaration/semantic surface source used for
   * implementation-change detection. Identity remains `id`; this is
   * evidence for ChangeSet/version analysis only.
   */
  fingerprint?: string;
  contract?: NodeContract;
};

export type ProjectGraphEdge = {
  from: string;
  to: string;
  kind:
    | "contains"
    | "imports"
    | "uses";
};

export type ProjectDeclarationConflict = {
  key: string;
  first: ProjectGraphNode;
  duplicate: ProjectGraphNode;
};

export type ProjectGraph = {
  rootDir: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  /**
   * Duplicate stable declarations are preserved as analysis evidence rather
   * than silently becoming a second Runtime identity.
   */
  declarationConflicts?:
    ProjectDeclarationConflict[];
};

export type WorkflowRuntimeImpact = {
  workflowId: string;
  totalExecutions: number;
  running: number;
  suspended: number;
  completed: number;
  failed: number;
  cancelled: number;
  versions: Record<string, number>;
  deployments: Record<string, number>;
  versionDeployments:
    Record<
      string,
      Record<
        string,
        number
      >
    >;
  suspensionComponents: Record<string, number>;
};


export type ChangeKind =
  | "add"
  | "modify"
  | "remove";

export type ChangeSetItem = {
  change: ChangeKind;
  kind: ProjectNodeKind;
  id: string;
  before?: ProjectGraphNode;
  after?: ProjectGraphNode;
  affected: Array<{
    kind: ProjectNodeKind;
    id: string;
    via: ProjectGraphEdge["kind"];
  }>;
};

export type ChangeSet = {
  items: ChangeSetItem[];
  summary: {
    added: number;
    modified: number;
    removed: number;
    affectedNodes: number;
  };
};


export type ChangeSafetyIssue = {
  severity:
    | "info"
    | "warning"
    | "error";
  code: string;
  message: string;
  kind?: ProjectNodeKind;
  id?: string;
};

export type ChangeSafetyReport = {
  safe: boolean;
  issues: ChangeSafetyIssue[];
};

export type ProjectInventory = {
  packages: string[];
  capabilities: string[];
  capabilityProviders?: Record<
    string,
    {
      packageName?: string;
      exportName?: string;
    }
  >;
  workflows: Array<{
    id: string;
    version: string;
  }>;
  surfaces: string[];
};

export type CapabilityResolutionPlan = {
  id: string;
  source:
    | "existing"
    | "mcp"
    | "install"
    | "generate";
  detail?: string;
  providerPackage?: string;
  providerVersion?: string;
  exportName?: string;
};

export type FilePlan = {
  path: string;
  purpose: string;
};

export type TestPlan = {
  id: string;
  description: string;
  kind:
    | "business"
    | "durability"
    | "security";
};

export type BuildPlan = {
  packageName: string;
  workflowIds: string[];
  /**
   * Target versions selected before implementation.
   * Existing durable identities must advance rather than overwrite.
   */
  workflowVersions: Record<
    string,
    string
  >;
  componentIds: string[];
  surfaceKinds: string[];
  capabilities:
    CapabilityResolutionPlan[];
  files: FilePlan[];
  tests: TestPlan[];
};



export type CapabilityResolutionEvidence = {
  id: string;
  requested: string;
  selected:
    | "existing"
    | "mcp"
    | "install"
    | "generate";
  reason: string;
  candidate?: {
    id: string;
    sourceKind: string;
    sourceName: string;
    score: number;
    packageVersion?: string;
    exportName?: string;
  };
};

export type CapabilityResolutionReport = {
  resolved: boolean;
  capabilities:
    CapabilityResolutionEvidence[];
  unresolvedRequired:
    string[];
};



export type CapabilityExtensionAction = {
  capabilityId: string;
  kind:
    | "install-package";
  packageName: string;
  version?: string;
};

export type CapabilityExtensionPlan = {
  required: boolean;
  actions:
    CapabilityExtensionAction[];
};

export type GeneratedArtifact = {
  path: string;
  content: string;
};

export type PreviewManifest = {
  packageName: string;
  entryWorkflow: string;
  surfaces: string[];
  capabilities: string[];
  demoScenarios: Array<{
    name: string;
    input: unknown;
    expected: string;
  }>;
};

export type VerificationReport = {
  passed: boolean;
  checks: Array<{
    id: string;
    passed: boolean;
    message: string;
  }>;
};

export type ImpactReport = {
  activeExecutionRisk:
    | "none"
    | "low"
    | "medium"
    | "high";
  versionRecommendation: string;
  notes: string[];
  runtime?: {
    workflows:
      WorkflowRuntimeImpact[];
    activeExecutions: number;
    suspendedExecutions: number;
  };
};


export type MigrationStrategy =
  | "none"
  | "version-isolation"
  | "compatibility-adapter"
  | "workflow-upgrade";

export type MigrationOption = {
  strategy:
    MigrationStrategy;
  safe: boolean;
  recommended: boolean;
  reason: string;
  requirements: string[];
};

export type MigrationPlan = {
  required: boolean;
  releaseAllowed: boolean;
  selected:
    MigrationStrategy;
  options:
    MigrationOption[];
  actions: Array<{
    type:
      | "keep-workflow-version"
      | "keep-deployment"
      | "route-new-executions"
      | "generate-adapter"
      | "register-workflow-upgrade"
      | "drain-executions";
    workflowId?: string;
    fromVersion?: string;
    toVersion?: string;
    detail: string;
  }>;
  artifacts:
    GeneratedArtifact[];
  verification: {
    passed: boolean;
    checks: Array<{
      id: string;
      passed: boolean;
      message: string;
    }>;
  };
};


export type DeploymentStep = {
  phase:
    | "deploy"
    | "cutover"
    | "retain"
    | "retire";
  action:
    | "publish-package"
    | "deploy-version"
    | "route-new-executions"
    | "keep-old-deployment"
    | "watch-drain"
    | "retire-old-deployment";
  workflowId: string;
  version?: string;
  deploymentId?: string;
  detail: string;
};

export type RetireGate = {
  workflowId: string;
  version: string;
  deploymentId?: string;
  requiredActiveExecutions: 0;
  currentActiveExecutions: number;
  currentSuspendedExecutions: number;
  ready: boolean;
  reasons: string[];
};

export type DeploymentPlan = {
  releaseAllowed: boolean;
  target: {
    packageName: string;
    packageVersion: string;
    workflowId: string;
    workflowVersion: string;
    deploymentId: string;
  };
  previous?: {
    workflowVersion: string;
    deploymentIds: string[];
  };
  steps: DeploymentStep[];
  retireGate?: RetireGate;
  artifact:
    GeneratedArtifact;
  verification: {
    passed: boolean;
    checks: Array<{
      id: string;
      passed: boolean;
      message: string;
    }>;
  };
};

export type ReleaseProposal = {
  packageName: string;
  version: string;
  artifacts: GeneratedArtifact[];
  preview: PreviewManifest;
  verification: VerificationReport;
  impact: ImpactReport;
  changeSet?: ChangeSet;
  changeSafety?: ChangeSafetyReport;
  contractCompatibility?:
    ContractCompatibilityReport;
  architectureGovernance?:
    ProjectGovernanceReport;
  capabilityResolution?:
    CapabilityResolutionReport;
  extensionPlan?:
    CapabilityExtensionPlan;
  migrationPlan?:
    MigrationPlan;
  deploymentPlan?:
    DeploymentPlan;
  permissions: string[];
};

export type BuilderResult = {
  request: RequirementRequest;
  inventory: ProjectInventory;
  spec: BusinessSpec;
  plan: BuildPlan;
  proposal: ReleaseProposal;
};


export type ArchitectureIssueSeverity =
  | "info"
  | "warning"
  | "error";

export type ArchitectureIssue = {
  severity:
    ArchitectureIssueSeverity;
  code: string;
  message: string;
  nodeKey?: string;
  packageName?: string;
  file?: string;
  path?: string[];
};

export type ProjectGovernancePolicy = {
  /**
   * Architecture smells, not Runtime limits.
   */
  maxDirectUses?: number;
  maxWorkflowDependencyDepth?:
    number;

  /**
   * Optional organization convention:
   * { "@acme/commerce": "commerce." }
   */
  packageNamespaces?:
    Record<
      string,
      string
    >;

  /**
   * Public subpaths may be explicitly allowed by a package.
   */
  allowedDeepImports?:
    string[];
};

export type ProjectGovernanceReport = {
  healthy: boolean;
  issues:
    ArchitectureIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    packages: number;
    workflows: number;
    components: number;
    edges: number;
  };
};

export type ImpactPath = {
  target:
    ProjectGraphNode;
  path:
    ProjectGraphNode[];
  edgeKinds:
    ProjectGraphEdge["kind"][];
};

export type ProjectImpactReport = {
  source:
    ProjectGraphNode;
  directlyAffected:
    ProjectGraphNode[];
  transitivelyAffected:
    ProjectGraphNode[];
  paths:
    ImpactPath[];
};
