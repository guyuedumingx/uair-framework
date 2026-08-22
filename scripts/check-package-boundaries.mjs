import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const packagesRoot = join(root, "packages");
const dirs = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory());
const manifests = new Map();

for (const dir of dirs) {
  let source;
  try {
    source = await readFile(join(packagesRoot, dir.name, "package.json"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  const manifest = JSON.parse(source);
  manifests.set(manifest.name, { dir: dir.name, manifest });
}

const internal = new Set(manifests.keys());
const graph = new Map();
const errors = [];

for (const [name, { manifest }] of manifests) {
  const runtimeDeps = {
    ...manifest.dependencies,
    ...manifest.peerDependencies
  };
  graph.set(name, Object.keys(runtimeDeps).filter(dep => internal.has(dep)));

  if (name !== "@uair/core" && manifest.dependencies?.["@uair/core"]) {
    errors.push(`${name} must peer-depend on @uair/core instead of bundling another Core`);
  }
}

const capabilityDeps = new Set(graph.get("@uair/capability") ?? []);
for (const forbidden of ["@uair/agent", "@uair/mcp", "@uair/package", "@uair/security", "@uair/sandbox"]) {
  if (capabilityDeps.has(forbidden)) errors.push(`@uair/capability must not depend on ${forbidden}`);
}

const visiting = new Set();
const visited = new Set();
const visit = (name, path = []) => {
  if (visiting.has(name)) {
    errors.push(`runtime package cycle: ${[...path, name].join(" -> ")}`);
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  for (const dep of graph.get(name) ?? []) visit(dep, [...path, name]);
  visiting.delete(name);
  visited.add(name);
};
for (const name of graph.keys()) visit(name);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("UAIR package boundary check: PASS");
console.log(JSON.stringify(Object.fromEntries(graph), null, 2));
