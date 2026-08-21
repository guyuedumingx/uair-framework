import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

import {
  resolve
} from "node:path";

function stableBase(
  packageName:
    string
) {
  return packageName
    .replace(
      /^@/,
      ""
    )
    .replace(
      /[^a-zA-Z0-9]+/g,
      "."
    )
    .replace(
      /^\.+|\.+$/g,
      ""
    )
    .toLowerCase();
}

export async function scaffoldUairPackage(
  input: {
    dir: string;
    packageName: string;
    version?: string;
    capabilityId?: string;
  }
) {
  const dir =
    resolve(
      input.dir
    );

  const version =
    input.version ??
    "0.1.0";

  const packageMetadata =
    JSON.parse(
      await readFile(
        new URL(
          "../package.json",
          import.meta.url
        ),
        "utf8"
      )
    ) as {
      version: string;
    };

  const uairVersion =
    packageMetadata.version;

  const capabilityId =
    input.capabilityId ??
    `${stableBase(input.packageName)}.example`;

  await mkdir(
    resolve(
      dir,
      "src"
    ),
    {
      recursive: true
    }
  );

  await writeFile(
    resolve(
      dir,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          input.packageName,
        version,
        type:
          "module",
        license:
          "MIT",
        main:
          "./dist/index.js",
        types:
          "./dist/index.d.ts",
        exports: {
          ".":
            {
              types:
                "./dist/index.d.ts",
              import:
                "./dist/index.js"
            },
          "./uair":
            {
              types:
                "./dist/uair.d.ts",
              import:
                "./dist/uair.js"
            }
        },
        files: [
          "dist"
        ],
        scripts: {
          build:
            "tsc -p tsconfig.json",
          test:
            "node --test"
        },
        dependencies: {
          "@uair/core":
            `^${uairVersion}`,
          "@uair/package":
            `^${uairVersion}`
        },
        devDependencies: {
          typescript:
            "^5.9.2"
        },
        publishConfig: {
          access:
            "public"
        }
      },
      null,
      2
    ) +
    "\n",
    "utf8"
  );

  await writeFile(
    resolve(
      dir,
      "tsconfig.json"
    ),
    JSON.stringify(
      {
        compilerOptions: {
          target:
            "ES2022",
          module:
            "NodeNext",
          moduleResolution:
            "NodeNext",
          declaration:
            true,
          outDir:
            "dist",
          rootDir:
            "src",
          strict:
            true,
          skipLibCheck:
            true
        },
        include: [
          "src/**/*.ts"
        ]
      },
      null,
      2
    ) +
    "\n",
    "utf8"
  );

  await writeFile(
    resolve(
      dir,
      "src",
      "index.ts"
    ),
    `export {
  example
} from "./uair.js";
`,
    "utf8"
  );

  await writeFile(
    resolve(
      dir,
      "src",
      "uair.ts"
    ),
    `import {
  component
} from "@uair/core";

import {
  capability,
  type UairPackageManifest
} from "@uair/package";

export const example =
  component(
    ${JSON.stringify(capabilityId)},
    async (
      input:
        Record<
          string,
          unknown
        > |
        undefined
    ) => ({
      value:
        typeof input?.value ===
          "string"
          ? input.value
          : ""
    })
  );

export const uair:
  UairPackageManifest = {
  name:
    ${JSON.stringify(input.packageName)},
  version:
    ${JSON.stringify(version)},
  components: {
    example
  },
  capabilities: [
    capability({
      id:
        ${JSON.stringify(capabilityId + ".tool")},
      kind:
        "tool",
      description:
        "Example UAIR package capability",
      invoke:
        example,
      metadata: {
        exportName:
          "example"
      }
    })
  ]
};

export default uair;
`,
    "utf8"
  );

  await writeFile(
    resolve(
      dir,
      "README.md"
    ),
    `# ${input.packageName}

UAIR package.

\`\`\`bash
npm install
npm run build
npm test
npm pack --dry-run
\`\`\`

Public UAIR contract is exported from \`${input.packageName}/uair\`.
`,
    "utf8"
  );

  return {
    dir,
    packageName:
      input.packageName,
    version,
    capabilityId
  };
}
