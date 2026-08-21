# CODEOWNERS Example

UAIR does not implement team ownership in Runtime Core. Use the repository
platform.

Example:

```text
/packages/commerce/payment/   @company/payment-team
/packages/commerce/order/     @company/order-team
/packages/security/           @company/security-team

/packages/core/               @company/uair-core-maintainers
```

For the UAIR framework repository itself, changes under `packages/core/` should
receive stricter review than ordinary domain/tooling changes.

Organizations can combine CODEOWNERS with branch protection:

```text
Core
→ specialist approval required

Security
→ security approval required

Domain package
→ owning domain team required
```

Architecture governance then provides deterministic structural evidence while
CODEOWNERS provides organizational authority.
