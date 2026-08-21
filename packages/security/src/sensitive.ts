import type {
  Execution
} from "@uair/core";

import type {
  Storage,
  SuspensionCreated
} from "@uair/core/runtime";

export type SecretRef = {
  readonly $uairSecretRef:
    string;
};

export function secretRef(
  reference: string
): SecretRef {
  if (
    !reference ||
    reference.trim() ===
      ""
  ) {
    throw new Error(
      "SecretRef requires a non-empty opaque reference."
    );
  }

  return {
    $uairSecretRef:
      reference
  };
}

export function isSecretRef(
  value: unknown
): value is SecretRef {
  return (
    typeof value ===
      "object" &&
    value !== null &&
    typeof (
      value as
        Partial<
          SecretRef
        >
    ).$uairSecretRef ===
      "string"
  );
}

export type SensitiveDataFinding = {
  path: string;
  reason: string;
};

export type SensitiveDataPolicy = {
  /**
   * Key names are normalized by removing punctuation and lower-casing.
   */
  sensitiveKeys?:
    string[];

  /**
   * Optional high-confidence raw-value patterns.
   */
  sensitiveValuePatterns?:
    RegExp[];

  /**
   * Custom allow hook for values intentionally persisted.
   */
  allow?:
    (
      path: string,
      value: unknown
    ) => boolean;
};

const DEFAULT_KEYS =
  new Set([
    "password",
    "passwd",
    "pwd",
    "token",
    "accesstoken",
    "refreshtoken",
    "authtoken",
    "authorization",
    "cookie",
    "setcookie",
    "secret",
    "clientsecret",
    "apikey",
    "privatekey"
  ]);

const DEFAULT_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];

function normalizeKey(
  value: string
) {
  return value
    .replace(
      /[^a-z0-9]/gi,
      ""
    )
    .toLowerCase();
}

export function findRawSecrets(
  value: unknown,
  policy:
    SensitiveDataPolicy =
      {}
): SensitiveDataFinding[] {
  const keySet =
    new Set([
      ...DEFAULT_KEYS,
      ...(
        policy
          .sensitiveKeys ??
        []
      ).map(
        normalizeKey
      )
    ]);

  const patterns = [
    ...DEFAULT_VALUE_PATTERNS,
    ...(
      policy
        .sensitiveValuePatterns ??
      []
    )
  ];

  const findings:
    SensitiveDataFinding[] =
    [];

  const seen =
    new WeakSet<object>();

  const visit =
    (
      current: unknown,
      path: string,
      key?: string
    ) => {
      if (
        policy.allow?.(
          path,
          current
        )
      ) {
        return;
      }

      if (
        isSecretRef(
          current
        )
      ) {
        return;
      }

      if (
        key &&
        keySet.has(
          normalizeKey(
            key
          )
        ) &&
        current !==
          undefined &&
        current !==
          null
      ) {
        findings.push({
          path,
          reason:
            `sensitive key "${key}" contains a raw durable value`
        });

        return;
      }

      if (
        typeof current ===
          "string"
      ) {
        for (
          const pattern
          of patterns
        ) {
          pattern.lastIndex =
            0;

          if (
            pattern.test(
              current
            )
          ) {
            findings.push({
              path,
              reason:
                `value matches sensitive pattern ${String(pattern)}`
            });

            return;
          }
        }

        return;
      }

      if (
        typeof current !==
          "object" ||
        current === null
      ) {
        return;
      }

      if (
        seen.has(
          current
        )
      ) {
        return;
      }

      seen.add(
        current
      );

      if (
        Array.isArray(
          current
        )
      ) {
        current.forEach(
          (
            item,
            index
          ) =>
            visit(
              item,
              `${path}[${index}]`
            )
        );

        return;
      }

      for (
        const [
          childKey,
          child
        ]
        of Object.entries(
          current as
            Record<
              string,
              unknown
            >
        )
      ) {
        visit(
          child,
          path
            ? `${path}.${childKey}`
            : childKey,
          childKey
        );
      }
    };

  visit(
    value,
    "$"
  );

  return findings;
}

export class RawSecretPersistenceError
  extends Error {
  constructor(
    readonly findings:
      SensitiveDataFinding[]
  ) {
    super(
      `Refusing to persist ${findings.length} raw sensitive value(s). ` +
      `Use an opaque SecretRef or remove the secret before durable execution. ` +
      findings
        .slice(
          0,
          3
        )
        .map(
          finding =>
            `${finding.path}: ${finding.reason}`
        )
        .join("; ")
    );

    this.name =
      "RawSecretPersistenceError";
  }
}

export function assertNoRawSecrets(
  value: unknown,
  policy:
    SensitiveDataPolicy =
      {}
) {
  const findings =
    findRawSecrets(
      value,
      policy
    );

  if (
    findings.length >
      0
  ) {
    throw new RawSecretPersistenceError(
      findings
    );
  }
}

/**
 * Storage policy wrapper.
 *
 * It does NOT redact durable values after the fact, because mutating History
 * would break replay semantics. It fails closed before persistence instead.
 */
export class SensitiveDataGuardStorage
  implements Storage {
  constructor(
    private readonly inner:
      Storage,
    private readonly policy:
      SensitiveDataPolicy =
        {}
  ) {}

  loadExecution(
    id: string
  ) {
    return this.inner
      .loadExecution(id);
  }

  listExecutions() {
    return this.inner
      .listExecutions();
  }

  findSuspension(
    suspensionId:
      string
  ) {
    return this.inner
      .findSuspension(
        suspensionId
      );
  }

  listSuspensions() {
    return this.inner
      .listSuspensions();
  }

  async saveExecution(
    execution:
      Execution,
    expectedRevision?:
      number
  ) {
    assertNoRawSecrets(
      execution,
      this.policy
    );

    await this.inner
      .saveExecution(
        execution,
        expectedRevision
      );
  }

  async indexSuspension(
    executionId: string,
    suspension:
      SuspensionCreated
  ) {
    assertNoRawSecrets(
      suspension,
      this.policy
    );

    await this.inner
      .indexSuspension(
        executionId,
        suspension
      );
  }

  removeSuspensionIndex(
    suspensionId:
      string
  ) {
    return this.inner
      .removeSuspensionIndex(
        suspensionId
      );
  }

  async saveExecutionAndIndexSuspension(
    execution:
      Execution,
    suspension:
      SuspensionCreated,
    expectedRevision?:
      number
  ) {
    assertNoRawSecrets(
      {
        execution,
        suspension
      },
      this.policy
    );

    if (
      this.inner
        .saveExecutionAndIndexSuspension
    ) {
      return this.inner
        .saveExecutionAndIndexSuspension(
          execution,
          suspension,
          expectedRevision
        );
    }

    await this.inner
      .saveExecution(
        execution,
        expectedRevision
      );

    await this.inner
      .indexSuspension(
        execution.id,
        suspension
      );
  }

  async saveExecutionAndRemoveSuspension(
    execution:
      Execution,
    suspensionId: string,
    expectedRevision?:
      number
  ) {
    assertNoRawSecrets(
      execution,
      this.policy
    );

    if (
      this.inner
        .saveExecutionAndRemoveSuspension
    ) {
      return this.inner
        .saveExecutionAndRemoveSuspension(
          execution,
          suspensionId,
          expectedRevision
        );
    }

    await this.inner
      .saveExecution(
        execution,
        expectedRevision
      );

    await this.inner
      .removeSuspensionIndex(
        suspensionId
      );
  }
}

export function redactText(
  value: string,
  replacement =
    "[REDACTED]"
) {
  return value
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
      `Bearer ${replacement}`
    )
    .replace(
      /\bsk-[A-Za-z0-9_-]{12,}\b/g,
      replacement
    )
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      replacement
    );
}

export function redactRecord(
  input:
    Record<
      string,
      string |
      number |
      boolean
    >,
  replacement =
    "[REDACTED]"
) {
  const output:
    Record<
      string,
      string |
      number |
      boolean
    > = {};

  for (
    const [
      key,
      value
    ]
    of Object.entries(
      input
    )
  ) {
    if (
      DEFAULT_KEYS.has(
        normalizeKey(
          key
        )
      )
    ) {
      output[key] =
        replacement;

      continue;
    }

    output[key] =
      typeof value ===
        "string"
        ? redactText(
            value,
            replacement
          )
        : value;
  }

  return output;
}
