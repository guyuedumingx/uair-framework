import type {
  BusinessSpec,
  BuildPlan,
  CapabilityResolutionReport,
  CapabilityExtensionPlan,
  ChangeSafetyReport,
  ChangeSet,
  ContractCompatibilityReport,
  DeploymentPlan,
  GeneratedArtifact,
  ImpactReport,
  MigrationPlan,
  PreviewManifest,
  ProjectInventory,
  ProjectGovernanceReport,
  ReleaseProposal,
  RequirementRequest,
  VerificationReport
} from "./types.js";

export interface ProjectInspector {
  inspect(): Promise<ProjectInventory>;
}

export interface RequirementAnalyst {
  analyze(
    request: RequirementRequest,
    inventory: ProjectInventory
  ): Promise<BusinessSpec>;
}

export interface SolutionArchitect {
  plan(
    spec: BusinessSpec,
    inventory: ProjectInventory
  ): Promise<BuildPlan>;
}

export interface CapabilityResolutionPlanner {
  resolve(
    spec: BusinessSpec,
    plan: BuildPlan,
    inventory: ProjectInventory
  ): Promise<{
    plan: BuildPlan;
    report:
      CapabilityResolutionReport;
  }>;
}

export interface ArtifactImplementer {
  implement(
    spec: BusinessSpec,
    plan: BuildPlan
  ): Promise<GeneratedArtifact[]>;
}

export interface ArtifactVerifier {
  verify(
    spec: BusinessSpec,
    plan: BuildPlan,
    artifacts: GeneratedArtifact[]
  ): Promise<VerificationReport>;
}

export interface ImpactAnalyzer {
  analyze(
    spec: BusinessSpec,
    plan: BuildPlan,
    inventory: ProjectInventory
  ): Promise<ImpactReport>;
}


export interface MigrationPlanner {
  plan(
    input: {
      spec: BusinessSpec;
      buildPlan: BuildPlan;
      changeSet?: ChangeSet;
      changeSafety?: ChangeSafetyReport;
      contractCompatibility?:
        ContractCompatibilityReport;
      impact: ImpactReport;
    }
  ): Promise<MigrationPlan>;
}


export interface DeploymentPlanner {
  plan(
    input: {
      spec: BusinessSpec;
      buildPlan: BuildPlan;
      impact: ImpactReport;
      migrationPlan?: MigrationPlan;
      packageVersion: string;
    }
  ): Promise<DeploymentPlan>;
}

export interface PreviewBuilder {
  build(
    spec: BusinessSpec,
    plan: BuildPlan,
    artifacts: GeneratedArtifact[]
  ): Promise<PreviewManifest>;
}


export interface ChangeAnalyzer {
  analyze(
    spec: BusinessSpec,
    artifacts: GeneratedArtifact[]
  ): Promise<{
    changeSet: ChangeSet;
    safety: ChangeSafetyReport;
    contractCompatibility?:
      ContractCompatibilityReport;
    architectureGovernance?:
      ProjectGovernanceReport;
  }>;
}

export interface ReleasePlanner {
  propose(
    input: {
      spec: BusinessSpec;
      plan: BuildPlan;
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
    }
  ): Promise<ReleaseProposal>;
}
