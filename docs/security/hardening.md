# UAIR Security Hardening — v0.55

v0.55 closes the first executable Security P0 boundary without adding new
Runtime Core primitives.

## 1. Durable secrets: reject, do not redact

Durable History is part of replay semantics. Replacing a secret value with
`[REDACTED]` after persistence can change Workflow behavior.

Therefore the production policy is:

```text
raw secret
→ MUST NOT enter durable Execution/History

opaque SecretRef
→ may enter durable state
```

Example:

```ts
secretRef(
  "vault://prod/payments/api-key"
)
```

`SensitiveDataGuardStorage` wraps any UAIR `Storage` and rejects high-confidence
raw values before persistence.

Default sensitive key classes include:

```text
password
token
accessToken
refreshToken
authorization
cookie
secret
clientSecret
apiKey
privateKey
```

It also detects high-confidence string forms such as bearer tokens and private
keys.

This is an outer security policy. Core still stores `unknown` application data.

## 2. Observability redaction

Trace/log export is different from durable replay.

`@uair/otel` now accepts an attribute sanitizer. `@uair/security` provides:

```text
redactText()
redactRecord()
```

so sensitive values can be removed at export time without mutating History.

Rule:

> Storage policy fails closed; observability policy redacts on export.

## 3. Capability authorization

Filtering a Capability list is not authorization.

An attacker/Agent may retain a reference and invoke it directly.

`bindCapabilities()` returns principal-bound invokers that re-check permission
at invocation time.

Capabilities without explicit:

```ts
metadata.permission
```

fail closed under the default RBAC authorizer.

Example:

```text
finance.payment.refund
permission = finance.refund
```

Only a principal allowed `finance.refund` reaches the underlying Component.

## 4. MCP HTTP SSRF boundary

`connectMcpHttp()` now executes a connection policy before importing/connecting
the MCP transport.

Default policy:

```text
HTTPS required
URL credentials denied
DNS must resolve
loopback denied
RFC1918/private IPv4 denied
link-local denied
CGNAT denied
IPv6 loopback/ULA/link-local denied
```

Every resolved address is checked. A hostname with one public and one private
answer is rejected, reducing DNS rebinding/multi-answer bypasses.

Hosts may inject a stricter allowlist policy.

## 5. MCP stdio boundary

Stdio MCP means process execution.

Therefore:

```text
connectMcpStdio()
without processPolicy
→ denied
```

Hosts must explicitly allow commands, e.g.:

```ts
allowListedMcpStdioPolicy([
  "node"
])
```

The adapter does not assume that an MCP server is trusted merely because it is
local.

## 6. Package identity vs behavior

Package trust has two independent questions:

```text
Who is this package?
What may this package do?
```

`verifiedPackageInstaller()` can enforce:

```text
package name
version
integrity
verified provenance

lifecycle scripts
native addons
network scope
filesystem scope
secret names
```

A package with valid provenance is still rejected if observed/requested
behavior exceeds policy.

Current sandbox installer already defaults lifecycle scripts off and restricts
ambient environment forwarding.

## 7. Tenant isolation

`TenantStorage` is a Host/security-layer namespace wrapper over the generic
Core `Storage` interface.

Two tenants can safely use identical:

```text
executionId
suspensionId
```

without colliding through the wrapper.

Hostile same-ID tests verify tenant A cannot retrieve tenant B's Execution or
Suspension through its namespace.

Strong production recommendation remains:

```text
highest isolation:
separate database/schema/credentials per tenant

shared storage:
TenantStorage or equivalent mandatory namespace enforcement
```

Queue, Gateway auth, credentials and external business databases must follow
the same tenant boundary. `TenantStorage` is not a substitute for authenticating
the tenant before the request reaches UAIR.

## Executable hostile tests

`npm run check:security-hardening` verifies:

```text
raw durable password rejected
SecretRef accepted
trace attributes redacted

authorized Capability invoke allowed
unauthorized Capability invoke denied before underlying call
unclassified Capability fails closed

public MCP target policy accepted
loopback SSRF denied
cloud metadata/link-local denied
mixed public/private DNS answer denied
plain HTTP denied
stdio process without policy denied
stdio allowlist enforcement

package integrity mismatch denied
missing/invalid behavior evidence denied
signed package with excessive behavior denied

same execution/suspension IDs across two tenants remain isolated
```

## Still outside this security layer

UAIR does not become an IAM, Vault, service mesh or package registry.

Production hosts still own:

```text
authentication
tenant establishment
secret retrieval
network sandbox enforcement
OS/container isolation
package-registry trust roots
credential rotation
audit retention policy
```

v0.55 provides enforcement hooks and fail-closed reference policies without
moving those systems into Core.
