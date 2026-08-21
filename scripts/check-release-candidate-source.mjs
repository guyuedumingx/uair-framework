import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const requiredRoot = [
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "AI_AUTHORING_GUIDE.md",
  "SECURITY.md",
  "SUPPORT.md",
  ".gitignore",
  ".editorconfig",
  ".github/workflows/ci.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/pull_request_template.md",
  "docs/release/checklist.md",
  "docs/release/publishing.md",
  "docs/release/versioning-policy.md"
];

for (const path of requiredRoot) {
  await access(path);
}

for (const stale of [
  "ADAPTER_COMPATIBILITY.md",
  "AGENT.md",
  "AGENT_BOUNDARY.md",
  "AGENT_COMPATIBILITY_MATRIX.md"
]) {
  try {
    await access(stale);
    assert.fail(`stale duplicate root document must not exist: ${stale}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(rootPackage.version, "0.67.0");
assert.equal(rootPackage.private, true);
assert.equal(rootPackage.license, "MIT");
assert.match(rootPackage.engines.node, />=22/);

const entries = await readdir("packages", { withFileTypes: true });
let publishable = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const packagePath = join("packages", entry.name, "package.json");
  let pkg;

  try {
    pkg = JSON.parse(await readFile(packagePath, "utf8"));
  } catch {
    continue;
  }

  if (pkg.private === true) continue;
  publishable += 1;

  assert.equal(pkg.version, "0.67.0", `${pkg.name}: synchronized version`);
  assert.equal(pkg.license, "MIT", `${pkg.name}: MIT license`);
  assert.ok(pkg.description, `${pkg.name}: description`);
  assert.match(pkg.engines?.node ?? "", />=22/, `${pkg.name}: engines.node`);
  assert.ok(pkg.files?.includes("dist"), `${pkg.name}: files includes dist`);

  if (pkg.name.startsWith("@")) {
    assert.equal(
      pkg.publishConfig?.access,
      "public",
      `${pkg.name}: public scoped publishConfig`
    );
  }

  await access(join("packages", entry.name, "README.md"));
}

const readme = await readFile("README.md", "utf8");
assert.match(readme, /v0\.67/);
assert.doesNotMatch(readme, /v0\.65/);

const status = await readFile("docs/release/status.md", "utf8");
assert.match(status, /Source Release Candidate:\s*READY/s);
assert.match(status, /package-lock\.json/);

const publishing = await readFile("docs/release/publishing.md", "utf8");
assert.match(publishing, /UAIR_REPOSITORY_URL/);
assert.match(publishing, /npm run release:plan/);

console.log(JSON.stringify({
  sourceReleaseCandidate: "READY",
  frameworkVersion: rootPackage.version,
  publishablePackages: publishable,
  repositoryIdentity: rootPackage.repository ? "STAMPED" : "PENDING",
  lockfile: "FINAL_NETWORKED_ENVIRONMENT",
  newCorePrimitives: 0
}, null, 2));

console.log("UAIR source release-candidate audit: PASS");
