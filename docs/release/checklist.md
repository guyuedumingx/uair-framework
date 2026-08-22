# Release Checklist

## Source and repository

- [x] MIT LICENSE present.
- [x] `.gitignore` and `.editorconfig` present.
- [x] SECURITY policy present.
- [x] Issue and PR templates present.
- [x] Base GitHub CI workflow present.
- [x] Root documentation is current-product documentation.
- [x] Experimental surfaces are explicitly marked.
- [x] Package README files exist.
- [x] Real repository/homepage/bugs metadata stamped after GitHub repository creation.
- [x] `package-lock.json` generated in a networked Node 24 environment.
- [x] `package-lock.json` committed after this source archive is attached to Git.

## Version and package metadata

- [x] Publishable workspace versions synchronized.
- [x] MIT license metadata.
- [x] Package descriptions.
- [x] Node.js engine requirement.
- [x] `files` limits package payload.
- [x] Scoped public packages use `publishConfig.access=public`.
- [x] Deterministic dependency-ordered publish plan.
- [x] Versioning/breaking-change policy documented.

## API and architecture

- [x] Core primitive set frozen by policy.
- [x] Preferred UI API converged.
- [x] Legacy UI API deprecated.
- [x] Runtime/cluster/internal tiers documented.
- [x] Architecture governance passes.
- [x] Package/private import boundaries checked.
- [x] AI extension approval remains separate from trust/security authorization.

## Local deterministic gates

Run:

```bash
npm run clean
npm run build
npm run release:preflight
```

Then:

```bash
npm run release:plan
```

`release:plan` must report zero issues.

## Final environment gates

Current final-environment status:

- [x] live PostgreSQL 16 suite on macOS;
- [x] 50-cycle live resilience soak;
- [ ] long soak;
- [x] mixed-binary rolling upgrade (published v0.67 + candidate v0.68 against shared PostgreSQL);
- [ ] real package registry/provenance;
- [ ] live external Agent SDK adapters;
- [ ] real gateway/network sandbox.

## Publish

- [x] source attached to `guyuedumingx/uair-framework` and working tree clean;
- [x] exact release commit identified (`v0.67.0`);
- [ ] npm identity/auth/provenance configured;
- [ ] packages published in `release:plan` order;
- [x] Git tag created;
- [x] GitHub Release created;
- [ ] fresh external `create-uair` smoke test passes.
