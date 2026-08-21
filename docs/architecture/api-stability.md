# API Stability Policy

The detailed v1-alpha contract is in `../release/v1-alpha-api.md`.

## Tier 1: application API

`@uair/core` is the candidate compatibility surface for v1. Application code
should prefer this entry point.

Preferred application packages such as `@uair/ui`, `@uair/agent`,
`@uair/interaction`, and `@uair/package` expose reviewed authoring APIs, but
their non-core outer interfaces may still receive additive alpha changes.

## Tier 2: runtime adapter API — alpha

`@uair/core/runtime` is alpha. Storage, history migration, deployment identity,
and manual suspension tooling may evolve.

Do not build ordinary business logic against this tier.

## Tier 3: cluster API — experimental

`@uair/core/cluster` is experimental. Queue/worker/scheduler class shapes are
not frozen.

Production adopters must pin versions and treat upgrades as compatibility
events.

## Tier 4: internal API — unstable

`@uair/core/internal` has no compatibility promise.

Application and package code must not import it.

## Experimental packages

`@uair/forge` is explicitly experimental. It is a synthesis pipeline, not part
of the v1 application compatibility promise.

Builder, sandbox and deployment-policy exact interfaces remain provisional even
where their high-level concepts are retained.

## Compatibility rule

Business behavior must not depend on raw History records or physical DB
schemas. Use Workflow/Component return values and documented adapters.
