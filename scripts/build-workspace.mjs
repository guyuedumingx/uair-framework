import {
  access,
  readFile,
  readdir
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  spawnSync
} from "node:child_process";

const root =
  process.cwd();

async function workspaceDirs(
  parent
) {
  const base =
    join(
      root,
      parent
    );

  const entries =
    await readdir(
      base,
      {
        withFileTypes:
          true
      }
    );

  return entries
    .filter(
      entry =>
        entry.isDirectory()
    )
    .map(
      entry =>
        join(
          parent,
          entry.name
        )
    );
}

const dirs = [
  ...await workspaceDirs(
    "packages"
  ),
  ...await workspaceDirs(
    "examples"
  )
];

const workspaces =
  new Map();

for (
  const dir
  of dirs
) {
  try {
    const pkg =
      JSON.parse(
        await readFile(
          join(
            root,
            dir,
            "package.json"
          ),
          "utf8"
        )
      );

    if (
      typeof pkg.name !==
        "string"
    ) {
      continue;
    }

    let hasTsconfig =
      true;

    try {
      await access(
        join(
          root,
          dir,
          "tsconfig.json"
        )
      );
    } catch {
      hasTsconfig =
        false;
    }

    workspaces.set(
      pkg.name,
      {
        name:
          pkg.name,
        dir,
        pkg,
        hasTsconfig
      }
    );
  } catch {}
}

function localDeps(
  workspace
) {
  const all = {
    ...workspace.pkg
      .dependencies,
    ...workspace.pkg
      .devDependencies,
    ...workspace.pkg
      .peerDependencies,
    ...workspace.pkg
      .optionalDependencies
  };

  return Object.keys(
    all
  ).filter(
    name =>
      workspaces.has(
        name
      )
  );
}

const visiting =
  new Set();

const visited =
  new Set();

const ordered = [];

function visit(
  name,
  path = []
) {
  if (
    visited.has(
      name
    )
  ) {
    return;
  }

  if (
    visiting.has(
      name
    )
  ) {
    throw new Error(
      `Workspace dependency cycle: ${[
        ...path,
        name
      ].join(" -> ")}`
    );
  }

  visiting.add(
    name
  );

  const current =
    workspaces.get(
      name
    );

  for (
    const dependency
    of localDeps(
      current
    )
  ) {
    visit(
      dependency,
      [
        ...path,
        name
      ]
    );
  }

  visiting.delete(
    name
  );

  visited.add(
    name
  );

  ordered.push(
    current
  );
}

for (
  const name
  of [
    ...workspaces.keys()
  ].sort()
) {
  visit(
    name
  );
}

let built =
  0;

for (
  const workspace
  of ordered
) {
  if (
    !workspace
      .hasTsconfig
  ) {
    continue;
  }

  console.log(
    `\n=== build ${workspace.name} (${workspace.dir}) ===`
  );

  const result =
    spawnSync(
      "npx",
      [
        "tsc",
        "-p",
        "tsconfig.json",
        "--pretty",
        "false"
      ],
      {
        cwd:
          join(
            root,
            workspace.dir
          ),
        stdio:
          "inherit",
        env:
          process.env
      }
    );

  if (
    result.status !== 0
  ) {
    process.exit(
      result.status ??
      1
    );
  }

  built += 1;
}

console.log(
  JSON.stringify(
    {
      discovered:
        workspaces.size,
      built,
      order:
        ordered
          .filter(
            item =>
              item
                .hasTsconfig
          )
          .map(
            item =>
              item.name
          )
    },
    null,
    2
  )
);

console.log(
  "UAIR workspace dependency-ordered build: PASS"
);
