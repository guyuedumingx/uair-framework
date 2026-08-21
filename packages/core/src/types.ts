export type ExecutionStatus =
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

export type EffectCompleted = {
  kind: "effect_completed";
  path: string;
  component: string;
  effectId: string;
  generation: number;
  startedAt?: number;
  completedAt: number;
  expiresAt?: number;
  input?: unknown;
  output: unknown;
  attributes?:
    ObservabilityAttributes;
  metrics?:
    ComponentMetrics;
};

export type EffectAttemptFailed = {
  kind: "effect_attempt_failed";
  path: string;
  component: string;
  effectId: string;
  generation: number;
  attempt: number;
  attemptStartedAt?: number;
  failedAt: number;
  input?: unknown;
  error: SerializedError;
  attributes?:
    ObservabilityAttributes;
  metrics?:
    ComponentMetrics;
};

export type SuspensionCreated = {
  kind: "suspension_created";
  path: string;
  component: string;
  effectId: string;
  generation: number;
  suspensionId: string;
  createdAt: number;
  input?: unknown;
  expiresAt?: number;
  resultValidForMs?: number;
  spec: unknown;
  attributes?:
    ObservabilityAttributes;
  metrics?:
    ComponentMetrics;
};

export type SuspensionResolved = {
  kind: "suspension_resolved";
  suspensionId: string;
  resolvedAt: number;
  value: unknown;

  /**
   * Optional opaque identity of the external resolver.
   * Runtime does not interpret users/roles; Interaction and other
   * adapters may persist an audit identity here.
   */
  resolvedBy?: string;
};

export type SuspensionCancelled = {
  kind: "suspension_cancelled";
  suspensionId: string;
  cancelledAt: number;
  reason?: string;
};

export type WorkflowUpgraded = {
  kind: "workflow_upgraded";
  workflow: string;
  fromVersion: string;
  toVersion: string;
  fromFingerprint?: string;
  toFingerprint?: string;
  upgradedAt: number;
};

export type WorkflowIdentityAdopted = {
  kind: "workflow_identity_adopted";
  workflow: string;
  version: string;
  fingerprint: string;
  deploymentId?: string;
  adoptedAt: number;
};

export type ResumeRequested = {
  kind: "resume_requested";
  requestId: string;
  suspensionId: string;
  requestedAt: number;
  reason:
    | "event"
    | "timer"
    | "manual"
    | "recovery";
};

export type HistoryEntry =
  | EffectCompleted
  | EffectAttemptFailed
  | SuspensionCreated
  | SuspensionResolved
  | SuspensionCancelled
  | ResumeRequested
  | WorkflowUpgraded
  | WorkflowIdentityAdopted;

export type Execution = {
  id: string;
  workflow: string;
  /**
   * Code version pinned when the execution is created.
   * Old records without this field are interpreted as version "1".
   */
  workflowVersion?: string;
  /**
   * Deployment identity pinned when this execution started.
   */
  deploymentId?: string;
  /**
   * Fingerprint of the exact Workflow implementation used when this
   * execution started.
   */
  workflowFingerprint?: string;
  /**
   * Durable history schema version. Old records without this field
   * are interpreted as schema version 1.
   */
  historySchemaVersion?: number;
  input: unknown;
  status: ExecutionStatus;
  history: HistoryEntry[];
  result?: unknown;
  error?: SerializedError;
  revision?: number;
};

export type SuspendOptions = {
  /**
   * How long the outstanding interaction/request itself is usable.
   * If it expires while unresolved, replay recreates the component
   * at the same path with a new generation.
   */
  expiresInMs?: number;

  /**
   * How long the resolved answer remains reusable.
   * Once stale, replay re-enters the component with ctx.previous.
   */
  resultValidForMs?: number;
};

export type PreviousResult<T = unknown> = {
  source: "effect" | "suspension";
  value: T;
  generation: number;
  completedAt?: number;
  resolvedAt?: number;
};

export type RetryPolicy = {
  /**
   * Total attempts including the first execution.
   */
  maxAttempts: number;

  /**
   * Delay before each retry. Kept intentionally simple for the PoC.
   */
  delayMs?: number;

  /**
   * Optional code-level filter. This function is not persisted;
   * deployment version pinning remains required in production.
   */
  retryIf?: (
    error: unknown,
    attempt: number
  ) => boolean;
};

export type ObservabilityAttributes =
  Record<
    string,
    string | number | boolean
  >;

export type ComponentMetrics =
  Record<
    string,
    number
  >;

export type ComponentOptions = {
  retry?: RetryPolicy;

  attributes?:
    ObservabilityAttributes;

  /**
   * Default TTL for ordinary completed effect results.
   * A component can override this dynamically with ctx.setResultExpiry().
   */
  resultValidForMs?: number;
};

export type ComponentContext = {
  /**
   * Stable for one structural path + generation, including retries.
   */
  effectId: string;

  generation: number;

  /**
   * 1-based attempt number for the current generation.
   */
  attempt: number;

  signal: AbortSignal;

  /**
   * Present when an older generation existed but became stale/expired.
   * Components can use it to refresh rather than starting from zero.
   */
  previous?: PreviousResult;

  /**
   * Override the expiry of the ordinary effect result produced by
   * the current handler execution.
   */
  setResultExpiry(expiresAt: number): void;

  setAttribute(
    key: string,
    value:
      string | number | boolean
  ): void;

  addMetric(
    key: string,
    value: number
  ): void;

  suspend<T>(
    spec: unknown,
    options?: SuspendOptions
  ): Promise<T>;
};

export type WorkflowDefinition<I = unknown, O = unknown> = {
  readonly kind: "workflow";
  /**
   * Stable durable identity. Prefer this in application code.
   */
  readonly id: string;
  /**
   * @deprecated Use `id`. Kept for v0.x compatibility.
   */
  readonly name: string;
  readonly version: string;
  readonly deploymentId?: string;
  readonly fingerprint?: string;
  readonly handler: (input: I) => Promise<O>;
};

export type WorkflowOptions = {
  /**
   * Durable code-evolution boundary. Omit for the initial/default "1".
   */
  version?: string;

  /**
   * Advanced host/deployment metadata.
   * Ordinary application Workflow authors should normally omit this.
   */
  deploymentId?: string;

  /**
   * Advanced compatibility metadata normally supplied by deployment/tooling.
   * Ordinary application Workflow authors should normally omit this.
   */
  fingerprint?: string;
};

export type Component<I = unknown, O = unknown> = {
  (input: I): Promise<O>;
  readonly kind: "component";
  /**
   * Stable durable identity. Prefer this in application code.
   */
  readonly id: string;
  /**
   * @deprecated Use `id`. Kept for v0.x compatibility.
   */
  readonly componentName: string;
};
