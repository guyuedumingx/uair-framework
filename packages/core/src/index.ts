/**
 * UAIR application API.
 *
 * v1-alpha rule: application code should normally need only this root entry.
 * Runtime adapters, cluster orchestration and low-level internals live in
 * explicit subpath exports so they do not accidentally become app contracts.
 */
export {
  component,
  workflow,
  parallel,
  race,
  run,
  resume
} from "./core.js";

export { RuntimeEngine } from "./engine.js";

export {
  NonDeterministicWorkflowError,
  ExecutionCancelledError,
  WorkflowVersionMismatchError
} from "./runtime.js";

export type {
  Component,
  ComponentContext,
  ComponentOptions,
  RetryPolicy,
  SuspendOptions,
  WorkflowDefinition,
  WorkflowOptions,
  Execution,
  ExecutionStatus,
  PreviousResult
} from "./types.js";
