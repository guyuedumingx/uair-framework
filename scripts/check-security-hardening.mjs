import assert from "node:assert/strict";
import {
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

import {
  component,
  run,
  workflow
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  CapabilitySet,
  capability
} from "../packages/package/dist/index.js";

import {
  allowListedMcpStdioPolicy,
  connectMcpStdio,
  defaultMcpHttpConnectionPolicy,
  McpConnectionDeniedError
} from "../packages/mcp/dist/index.js";

import {
  bindCapabilities,
  CapabilityPermissionDeniedError,
  RawSecretPersistenceError,
  SensitiveDataGuardStorage,
  TenantStorage,
  createRbac,
  rbacCapabilityAuthorizer,
  redactRecord,
  redactText,
  secretRef,
  staticTrustPolicy,
  verifiedPackageInstaller,
  PackageProvenanceError
} from "../packages/security/dist/index.js";

import {
  executionToSpans
} from "../packages/otel/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-security-"
    )
  );

try {
  // 1. Durable History secret policy: fail closed on raw secrets.
  const rawStorage =
    new JsonFileStorage(
      join(
        dir,
        "secret-guard",
        "executions"
      )
    );

  const guardedStorage =
    new SensitiveDataGuardStorage(
      rawStorage
    );

  const echo =
    workflow(
      "security.secret.echo",
      async input =>
        input
    );

  await assert.rejects(
    () =>
      run(
        echo,
        {
          username:
            "alice",
          password:
            "super-secret-password"
        },
        guardedStorage
      ),
    RawSecretPersistenceError,
    "raw password must never enter durable History/Execution"
  );

  const safe =
    await run(
      echo,
      {
        username:
          "alice",
        credential:
          secretRef(
            "vault://prod/payments/api-key"
          )
      },
      guardedStorage
    );

  assert.equal(
    safe.status,
    "completed"
  );

  assert.deepEqual(
    safe.result,
    {
      username:
        "alice",
      credential: {
        $uairSecretRef:
          "vault://prod/payments/api-key"
      }
    }
  );

  // 2. Trace/log export redaction stays outside durable semantics.
  const redactedAttributes =
    redactRecord({
      authorization:
        "Bearer abcdefghijklmnop",
      note:
        "token is sk-abcdefghijklmnop",
      count:
        3
    });

  assert.equal(
    redactedAttributes
      .authorization,
    "[REDACTED]"
  );

  assert.equal(
    String(
      redactedAttributes.note
    ).includes(
      "sk-abcdefghijklmnop"
    ),
    false
  );

  assert.equal(
    redactText(
      "Authorization: Bearer abcdefghijklmnop"
    ).includes(
      "abcdefghijklmnop"
    ),
    false
  );

  const traceExecution = {
    id:
      "trace-1",
    workflow:
      "trace.workflow",
    input: {},
    status:
      "completed",
    history: [
      {
        kind:
          "effect_attempt_failed",
        path:
          "0",
        component:
          "remote.call",
        effectId:
          "effect-1",
        generation:
          0,
        attempt:
          1,
        failedAt:
          1,
        error: {
          name:
            "Error",
          message:
            "Bearer abcdefghijklmnop"
        },
        attributes: {
          authorization:
            "Bearer abcdefghijklmnop",
          safe:
            "visible"
        }
      }
    ]
  };

  const spans =
    executionToSpans(
      traceExecution,
      {
        attribute:
          (
            key,
            value
          ) =>
            redactRecord({
              [key]:
                value
            })[key]
      }
    );

  assert.equal(
    spans[0]
      .attributes
      .authorization,
    "[REDACTED]"
  );

  // 3. Capability permission is enforced at invoke time, not only discovery.
  let protectedCalls =
    0;

  const protectedCapability =
    capability({
      id:
        "finance.payment.refund",
      kind:
        "tool",
      metadata: {
        permission:
          "finance.refund"
      },
      invoke:
        component(
          "finance.payment.refund.impl",
          async input => {
            protectedCalls +=
              1;

            return {
              refunded:
                true,
              input
            };
          }
        )
    });

  const unclassifiedCapability =
    capability({
      id:
        "dangerous.unclassified",
      kind:
        "tool",
      invoke:
        component(
          "dangerous.unclassified.impl",
          async () => ({
            ok: true
          })
        )
    });

  const capabilitySet =
    new CapabilitySet([
      protectedCapability,
      unclassifiedCapability
    ]);

  const rbac =
    createRbac([
      {
        role:
          "finance",
        allow: [
          "finance.refund"
        ]
      }
    ]);

  const financePrincipal = {
    id:
      "user:finance",
    roles: [
      "finance"
    ]
  };

  const employeePrincipal = {
    id:
      "user:employee",
    roles: [
      "employee"
    ]
  };

  const financeBound =
    bindCapabilities(
      financePrincipal,
      capabilitySet,
      rbacCapabilityAuthorizer(
        rbac.can
      )
    );

  const employeeBound =
    bindCapabilities(
      employeePrincipal,
      capabilitySet,
      rbacCapabilityAuthorizer(
        rbac.can
      )
    );

  const financeWorkflow =
    workflow(
      "security.cap.finance",
      async () =>
        financeBound
          .get(
            "finance.payment.refund"
          )
          .invoke({
            amount:
              100
          })
    );

  const financeExecution =
    await run(
      financeWorkflow,
      {},
      new JsonFileStorage(
        join(
          dir,
          "cap-finance"
        )
      )
    );

  assert.equal(
    financeExecution.status,
    "completed"
  );

  const employeeWorkflow =
    workflow(
      "security.cap.employee",
      async () =>
        employeeBound
          .get(
            "finance.payment.refund"
          )
          .invoke({
            amount:
              100
          })
    );

  await assert.rejects(
    () =>
      run(
        employeeWorkflow,
        {},
        new JsonFileStorage(
          join(
            dir,
            "cap-employee"
          )
        )
      ),
    CapabilityPermissionDeniedError
  );

  assert.equal(
    protectedCalls,
    1,
    "unauthorized invoke must not reach the underlying capability"
  );

  const unclassifiedWorkflow =
    workflow(
      "security.cap.unclassified",
      async () =>
        financeBound
          .get(
            "dangerous.unclassified"
          )
          .invoke({})
    );

  await assert.rejects(
    () =>
      run(
        unclassifiedWorkflow,
        {},
        new JsonFileStorage(
          join(
            dir,
            "cap-unclassified"
          )
        )
      ),
    CapabilityPermissionDeniedError,
    "capabilities without an explicit permission fail closed"
  );

  // 4. MCP hostile network/process boundaries.
  const publicPolicy =
    defaultMcpHttpConnectionPolicy({
      resolver:
        async () => [
          "93.184.216.34"
        ]
    });

  await publicPolicy
    .assertAllowed(
      new URL(
        "https://example.com/mcp"
      )
    );

  const loopbackPolicy =
    defaultMcpHttpConnectionPolicy({
      resolver:
        async () => [
          "127.0.0.1"
        ]
    });

  await assert.rejects(
    () =>
      loopbackPolicy
        .assertAllowed(
          new URL(
            "https://public-looking.example/mcp"
          )
        ),
    McpConnectionDeniedError
  );

  const metadataPolicy =
    defaultMcpHttpConnectionPolicy({
      resolver:
        async () => [
          "169.254.169.254"
        ]
    });

  await assert.rejects(
    () =>
      metadataPolicy
        .assertAllowed(
          new URL(
            "https://metadata.example/mcp"
          )
        ),
    McpConnectionDeniedError
  );

  const rebindingPolicy =
    defaultMcpHttpConnectionPolicy({
      resolver:
        async () => [
          "93.184.216.34",
          "10.0.0.8"
        ]
    });

  await assert.rejects(
    () =>
      rebindingPolicy
        .assertAllowed(
          new URL(
            "https://rebind.example/mcp"
          )
        ),
    McpConnectionDeniedError,
    "one private DNS answer must fail the whole target"
  );

  await assert.rejects(
    () =>
      defaultMcpHttpConnectionPolicy({
        resolver:
          async () => [
            "93.184.216.34"
          ]
      }).assertAllowed(
        new URL(
          "http://example.com/mcp"
        )
      ),
    McpConnectionDeniedError,
    "plain HTTP is denied by default"
  );

  await assert.rejects(
    () =>
      connectMcpStdio(
        "unsafe",
        {
          command:
            "/bin/sh",
          args: [
            "-c",
            "echo owned"
          ]
        }
      ),
    McpConnectionDeniedError,
    "stdio MCP cannot spawn without an explicit process policy"
  );

  const stdioPolicy =
    allowListedMcpStdioPolicy([
      "node"
    ]);

  assert.throws(
    () =>
      stdioPolicy.assertAllowed({
        command:
          "/bin/sh",
        args: [],
        envKeys: []
      }),
    McpConnectionDeniedError
  );

  // 5. Package provenance and behavioral evidence.
  const trust =
    staticTrustPolicy([
      {
        packageName:
          "@acme/safe",
        allowedVersions: [
          "1.0.0"
        ],
        integrity:
          "sha512-good",
        provenanceRequired:
          true,
        allowLifecycleScripts:
          false,
        allowNativeAddons:
          false,
        network:
          "registry-only",
        filesystem:
          "isolated",
        allowedSecrets: [
          "PACKAGE_TOKEN"
        ]
      }
    ]);

  const goodInstaller =
    verifiedPackageInstaller(
      {
        async install(
          packageName,
          version
        ) {
          return {
            packageName,
            version,
            integrity:
              "sha512-good",
            provenance: {
              verified:
                true,
              source:
                "sigstore"
            },
            evidence: {
              lifecycleScripts:
                false,
              nativeAddons:
                false,
              network:
                "registry-only",
              filesystem:
                "isolated",
              secretNames: [
                "PACKAGE_TOKEN"
              ]
            }
          };
        }
      },
      trust,
      "commerce.safe"
    );

  const installed =
    await goodInstaller
      .install(
        "@acme/safe",
        "1.0.0"
      );

  assert.equal(
    installed.provenance
      ?.verified,
    true
  );

  const badIntegrity =
    verifiedPackageInstaller(
      {
        async install(
          packageName,
          version
        ) {
          return {
            packageName,
            version,
            integrity:
              "sha512-evil",
            provenance: {
              verified:
                true
            }
          };
        }
      },
      trust,
      "commerce.safe"
    );

  await assert.rejects(
    () =>
      badIntegrity.install(
        "@acme/safe",
        "1.0.0"
      ),
    PackageProvenanceError
  );

  const hostileBehavior =
    verifiedPackageInstaller(
      {
        async install(
          packageName,
          version
        ) {
          return {
            packageName,
            version,
            integrity:
              "sha512-good",
            provenance: {
              verified:
                true
            },
            evidence: {
              lifecycleScripts:
                true,
              network:
                "any",
              filesystem:
                "host-readwrite",
              secretNames: [
                "AWS_SECRET_ACCESS_KEY"
              ]
            }
          };
        }
      },
      trust,
      "commerce.safe"
    );

  await assert.rejects(
    () =>
      hostileBehavior.install(
        "@acme/safe",
        "1.0.0"
      ),
    PackageProvenanceError,
    "signed/trusted identity must not bypass behavioral policy"
  );

  // 6. Tenant namespace hostile same-ID attack.
  const shared =
    new JsonFileStorage(
      join(
        dir,
        "tenants",
        "executions"
      )
    );

  const tenantA =
    new TenantStorage(
      "tenant-a",
      shared
    );

  const tenantB =
    new TenantStorage(
      "tenant-b",
      shared
    );

  const executionA = {
    id:
      "same-id",
    workflow:
      "tenant.workflow",
    input: {
      tenant:
        "A"
    },
    status:
      "suspended",
    history: [],
    revision:
      0
  };

  const executionB = {
    id:
      "same-id",
    workflow:
      "tenant.workflow",
    input: {
      tenant:
        "B"
    },
    status:
      "suspended",
    history: [],
    revision:
      0
  };

  const suspensionA = {
    kind:
      "suspension_created",
    path:
      "0",
    component:
      "wait",
    effectId:
      "effect-a",
    generation:
      0,
    suspensionId:
      "same-suspension",
    createdAt:
      1,
    spec: {
      tenant:
        "A"
    }
  };

  const suspensionB = {
    ...suspensionA,
    effectId:
      "effect-b",
    spec: {
      tenant:
        "B"
    }
  };

  await tenantA
    .saveExecutionAndIndexSuspension(
      executionA,
      suspensionA
    );

  await tenantB
    .saveExecutionAndIndexSuspension(
      executionB,
      suspensionB
    );

  assert.equal(
    (
      await tenantA
        .loadExecution(
          "same-id"
        )
    ).input.tenant,
    "A"
  );

  assert.equal(
    (
      await tenantB
        .loadExecution(
          "same-id"
        )
    ).input.tenant,
    "B"
  );

  assert.equal(
    (
      await tenantA
        .findSuspension(
          "same-suspension"
        )
    ).suspension.spec
      .tenant,
    "A"
  );

  assert.equal(
    (
      await tenantB
        .findSuspension(
          "same-suspension"
        )
    ).suspension.spec
      .tenant,
    "B"
  );

  assert.equal(
    (
      await tenantA
        .listExecutions()
    ).length,
    1
  );

  assert.equal(
    (
      await tenantB
        .listExecutions()
    ).length,
    1
  );

  const raw =
    await shared
      .listExecutions();

  assert.equal(
    raw.length,
    2,
    "shared physical storage contains both namespaces, host wrapper exposes one"
  );

  console.log(
    JSON.stringify(
      {
        durableSecrets:
          "PASS",
        traceRedaction:
          "PASS",
        capabilityInvokeAuthorization:
          "PASS",
        mcpSsrfBoundary:
          "PASS",
        mcpStdioBoundary:
          "PASS",
        packageProvenance:
          "PASS",
        packageBehaviorPolicy:
          "PASS",
        tenantNamespaceIsolation:
          "PASS"
      },
      null,
      2
    )
  );

  console.log(
    "UAIR Security P0 hostile-boundary verification: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
