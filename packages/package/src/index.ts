export {
  CapabilitySet,
  capability
} from "./capability.js";

export {
  loadUairPackage,
  loadInstalledUairPackage,
  collectCapabilities,
  validateUairPackageManifest
} from "./package-contract.js";

export {
  PackageDiscovery
} from "./package-discovery.js";

export {
  UairApplication
} from "./application.js";

export {
  CapabilityResolver
} from "./capability-resolver.js";

export {
  acquirePackage
} from "./acquisition.js";


export type {
  Capability,
  CapabilityKind,
  CapabilityPredicate
} from "./capability.js";

export type {
  UairPackageManifest,
  LoadedUairPackage,
  PackageManifestValidation
} from "./package-contract.js";

export type {
  CapabilityMatch
} from "./package-discovery.js";

export type {
  CapabilityCandidate,
  CapabilitySourceKind,
  InstallablePackageRecord,
  PackageCatalog
} from "./capability-resolver.js";

export type {
  AcquisitionDecision,
  AcquisitionRequest,
  AcquisitionPolicy,
  PackageInstaller
} from "./acquisition.js";



export {
  StaticPackageCatalog
} from "./catalog.js";


export {
  PackageLifecycleController
} from "./lifecycle.js";

export type {
  PackageLifecycleAdapter,
  PackageLifecyclePhase,
  PackageLifecycleReceipt,
  PackageLifecycleState
} from "./lifecycle.js";


export {
  scaffoldUairPackage
} from "./scaffold.js";


export {
  NodeNpmPackageLifecycleAdapter
} from "./npm-lifecycle.js";


export {
  catalogRecordFromManifest
} from "./catalog-record.js";
