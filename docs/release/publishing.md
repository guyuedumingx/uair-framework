# Publishing UAIR

This is the final source-release procedure for GitHub + npm.

## 1. Repository identity

UAIR does not ship fake repository URLs.

Once the GitHub repository exists, stamp real metadata:

```bash
UAIR_REPOSITORY_URL=https://github.com/ORG/REPO.git \
npm run release:metadata
```

Optional overrides:

```text
UAIR_HOMEPAGE_URL
UAIR_BUGS_URL
```

Commit the resulting `package.json` metadata before publishing.

## 2. Lockfile

Generate and commit the root lockfile in a networked development environment:

```bash
npm install
git add package-lock.json
```

The lockfile is required because CI/release automation must be reproducible.

## 3. Validate source release

```bash
npm run clean
npm ci
npm run build
npm run release:preflight
npm run release:plan
```

`release:plan` checks:

```text
single synchronized version
MIT license
description
files/dist
Node engine
public scoped publishConfig
repository/homepage/bugs metadata
package-lock presence
internal dependency publish order
```

## 4. Deferred environment gates

Before claiming the release has passed the final production-evidence stage, run
the separately documented live PostgreSQL / long-running / external integration
checks.

These are intentionally not replaced by source-only CI.

## 5. Publish order

Use the exact topological order printed by:

```bash
npm run release:plan
```

Publish dependencies before dependents.

For each package:

```bash
cd <package-dir>
npm publish --access public
```

`create-uair` is unscoped and does not require `--access public`.

Do not publish from an uncommitted/dirty source tree.

## 6. npm provenance

Prefer npm Trusted Publishing / OIDC provenance when the repository and npm
packages are configured for it.

If token-based publishing is temporarily required, use a short-lived,
least-privilege automation credential. Never commit npm tokens.

## 7. GitHub release

After npm publication:

```text
tag the exact release commit
create GitHub Release
attach source release notes
link CHANGELOG entry
record deferred/live validation evidence
```

Recommended tag:

```text
v0.67.0
```

## 8. Post-publish smoke

In a fresh directory:

```bash
npm create uair@latest smoke-app
cd smoke-app
npm install
npm run dev
```

Also install representative packages from npm rather than workspace links.

## Rollback

npm package versions are immutable and should not be overwritten.

If a bad version is published:

```text
publish a corrected new version
deprecate the bad version if necessary
document impact
```

Do not attempt to mutate an already published tarball.
