import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const targetVersion = rootPackage.version;

try {
  await readFile(join(root, "package-lock.json"), "utf8");
} catch {
  // npm ci / reproducible release automation requires a committed lockfile.
}

const entries = await readdir(join(root, "packages"), { withFileTypes: true });
const packages = new Map();

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const path = join(root, "packages", entry.name, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8"));

  if (pkg.private === true) continue;

  packages.set(pkg.name, {
    name: pkg.name,
    dir: `packages/${entry.name}`,
    pkg
  });
}

const issues = [];

try {
  await readFile(join(root, "package-lock.json"), "utf8");
} catch {
  issues.push("root: package-lock.json is required before public release");
}

const repositoryStamped =
  Boolean(
    rootPackage.repository &&
    rootPackage.homepage &&
    rootPackage.bugs?.url
  );

if (!repositoryStamped) {
  issues.push(
    "root: repository identity is not stamped (run release:metadata with UAIR_REPOSITORY_URL)"
  );
}

for (const item of packages.values()) {
  const pkg = item.pkg;

  if (pkg.version !== targetVersion) {
    issues.push(`${pkg.name}: version ${pkg.version} != root ${targetVersion}`);
  }

  if (pkg.license !== "MIT") {
    issues.push(`${pkg.name}: license must be MIT`);
  }

  if (!pkg.description) {
    issues.push(`${pkg.name}: description is required`);
  }

  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    issues.push(`${pkg.name}: files must include dist`);
  }

  if (!pkg.engines?.node) {
    issues.push(`${pkg.name}: engines.node is required`);
  }

  if (pkg.name.startsWith("@") && pkg.publishConfig?.access !== "public") {
    issues.push(`${pkg.name}: scoped public package requires publishConfig.access=public`);
  }

  if (repositoryStamped) {
    if (!pkg.repository) {
      issues.push(`${pkg.name}: repository metadata is not stamped`);
    }

    if (!pkg.homepage) {
      issues.push(`${pkg.name}: homepage metadata is not stamped`);
    }

    if (!pkg.bugs?.url) {
      issues.push(`${pkg.name}: bugs.url metadata is not stamped`);
    }
  }
}

function localDeps(item) {
  const all = {
    ...item.pkg.dependencies,
    ...item.pkg.peerDependencies,
    ...item.pkg.optionalDependencies
  };

  return Object.keys(all).filter(name => packages.has(name));
}

const visiting = new Set();
const visited = new Set();
const order = [];

function visit(name, path = []) {
  if (visited.has(name)) return;

  if (visiting.has(name)) {
    issues.push(`package dependency cycle: ${[...path, name].join(" -> ")}`);
    return;
  }

  visiting.add(name);
  const item = packages.get(name);

  for (const dep of localDeps(item)) {
    visit(dep, [...path, name]);
  }

  visiting.delete(name);
  visited.add(name);
  order.push(item);
}

for (const name of [...packages.keys()].sort()) {
  visit(name);
}

const result = {
  version: targetVersion,
  publishablePackages: packages.size,
  order: order.map(item => ({
    name: item.name,
    dir: item.dir
  })),
  issues
};

console.log(JSON.stringify(result, null, 2));

if (issues.length) {
  console.error("UAIR release plan: BLOCKED");
  process.exit(1);
}

console.log("UAIR release plan: PASS");
