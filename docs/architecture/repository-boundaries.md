# Repository boundaries

UAIR uses four repositories with one-way ownership:

```text
uair-framework
  public runtime contracts and generic adapters
       ↑              ↑              ↑
uair-builder    uair-integrations    uair-examples
tooling         provider bridges     references and domain proofs
```

The companion repositories may depend on published runtime packages. The
runtime repository must never depend on a companion repository.

## Runtime repository

`guyuedumingx/uair-framework` owns durable execution semantics, generic adapter
SPIs, storage adapters, interaction, policy and observability packages.

## Companion repositories

- `guyuedumingx/uair-builder`: project analysis, generation, governance CLI and
  release-planning tooling.
- `guyuedumingx/uair-integrations`: vendor/provider-specific adapters. A vendor
  SDK or protocol must not leak into a generic runtime package.
- `guyuedumingx/uair-examples`: runnable applications and domain references,
  including OA/approval.

Moving a feature into Core requires the Core admission rule. Moving it into the
runtime repository requires a provider-neutral contract with more than one
credible consumer.
