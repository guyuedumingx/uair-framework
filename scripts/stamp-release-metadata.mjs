import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const repository = process.env.UAIR_REPOSITORY_URL;

if (!repository) {
  console.error("UAIR_REPOSITORY_URL is required, e.g. https://github.com/ORG/REPO.git");
  process.exit(2);
}

const base = repository
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");

const homepage = process.env.UAIR_HOMEPAGE_URL ?? `${base}#readme`;
const bugs = process.env.UAIR_BUGS_URL ?? `${base}/issues`;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

const rootPackagePath = join(root, "package.json");
const rootPackage = await readJson(rootPackagePath);
rootPackage.repository = { type: "git", url: repository };
rootPackage.homepage = homepage;
rootPackage.bugs = { url: bugs };
await writeJson(rootPackagePath, rootPackage);

for (const workspace of ["packages", "examples"]) {
  const { readdir } = await import("node:fs/promises");

  let entries = [];

  try {
    entries = await readdir(
      join(root, workspace),
      { withFileTypes: true }
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      continue;
    }

    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packagePath = join(root, workspace, entry.name, "package.json");
    let pkg;

    try {
      pkg = await readJson(packagePath);
    } catch {
      continue;
    }

    if (workspace === "packages" && pkg.private !== true) {
      pkg.repository = {
        type: "git",
        url: repository,
        directory: `${workspace}/${entry.name}`
      };
      pkg.homepage = homepage;
      pkg.bugs = { url: bugs };
      await writeJson(packagePath, pkg);
    }
  }
}

console.log(JSON.stringify({ repository, homepage, bugs }, null, 2));
console.log("UAIR release metadata stamped: PASS");
