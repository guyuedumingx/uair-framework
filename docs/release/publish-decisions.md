# Publish Decisions

## License — RESOLVED

UAIR uses the MIT License.

The repository contains a root `LICENSE`, and publishable package manifests declare:

```json
"license": "MIT"
```

## npm namespace — MUST CONFIRM

Current scoped packages use:

```text
@uair/core
@uair/agent
@uair/ui
...
```

Before the first public publish, confirm that the publishing npm account owns or can create/use the `@uair` organization/scope.

Run:

```bash
npm whoami
npm org ls uair
npm view @uair/core
npm view create-uair
```

If `@uair` cannot be controlled, rename the scope before the first public release.
