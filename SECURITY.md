# Security Policy

## Supported versions

Until UAIR reaches 1.0, security fixes are provided for the latest published
alpha line only.

## Reporting a vulnerability

Do **not** open a public issue for a suspected vulnerability.

For a GitHub-hosted release, use the repository's private **Report a
vulnerability** / Security Advisory flow when available. If private reporting
is temporarily unavailable, contact the maintainer through a private channel
listed on the repository rather than disclosing exploit details publicly.

Please include:

- affected package and version;
- minimal reproduction;
- expected and observed security boundary;
- whether secrets, tenant data, package provenance, sandboxing, authorization,
  durable state, or remote code execution may be involved.

## Scope

Security-sensitive UAIR boundaries include:

- package trust and provenance;
- sandboxed acquisition/execution;
- capability and tenant authorization;
- secret persistence policy;
- external event authenticity;
- storage fencing/concurrency;
- release and extension authorization.

Operator approval is **not** a substitute for package trust or authorization.

## Disclosure

Please allow maintainers reasonable time to validate and prepare a fix before
public disclosure.
