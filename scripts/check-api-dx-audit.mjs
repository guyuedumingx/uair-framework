import assert from "node:assert/strict";

import {
  readFile
} from "node:fs/promises";

const read =
  path =>
    readFile(
      path,
      "utf8"
    );

const rootPackage =
  JSON.parse(
    await read(
      "package.json"
    )
  );

const currentVersion =
  `v${rootPackage.version.replace(/\.0$/, "")}`;

const readme =
  await read(
    "README.md"
  );

const quickStart =
  await read(
    "docs/getting-started/quick-start.md"
  );

const identity =
  await read(
    "docs/concepts/durable-identity.md"
  );

const uiSource =
  await read(
    "packages/ui/src/ui.ts"
  );

const surfaceSource =
  await read(
    "packages/ui/src/surface.ts"
  );

const workflowTypes =
  await read(
    "packages/core/src/types.ts"
  );

const audit =
  await read(
    "docs/release/api-dx-audit.md"
  );

assert.equal(
  readme.includes(
    currentVersion
  ),
  true,
  `README must identify current release candidate ${currentVersion}`
);

for (
  const stale
  of [
    "v0.55",
    "v0.56",
    "v0.57",
    "v0.58",
    "v0.59",
    "v0.60",
    "v0.61",
    "v0.62",
    "v0.63",
    "v0.64",
    "v0.65",
    "v0.66"
  ]
) {
  assert.equal(
    readme.includes(
      stale
    ),
    false,
    `README contains historical release diary text: ${stale}`
  );
}

assert.match(
  readme,
  /workflow\(\s*"commerce\.checkout"/s
);

assert.match(
  readme,
  /Initial Workflow version defaults to/
);

assert.doesNotMatch(
  quickStart,
  /version\s*:\s*"1"/,
  "Quick Start must not teach explicit initial Workflow version"
);

assert.match(
  identity,
  /Stable identity is mandatory in semantics, minimal in syntax/
);

for (
  const preferred
  of [
    "surface",
    "input",
    "choose",
    "present"
  ]
) {
  assert.match(
    readme,
    new RegExp(
      `\\b${preferred}\\(\\)`
    )
  );
}

assert.match(
  uiSource,
  /@deprecated Prefer `surface\(\)`, `input\(\)` or `choose\(\)`/
);

assert.match(
  uiSource,
  /@deprecated Prefer `present\(\)`/
);

assert.match(
  surfaceSource,
  /id:\s*"ui\.surface"/s
);

assert.match(
  surfaceSource,
  /id:\s*"ui\.input"/s
);

assert.match(
  surfaceSource,
  /id:\s*"ui\.choose"/s
);

assert.match(
  workflowTypes,
  /Advanced host\/deployment metadata/
);

assert.match(
  workflowTypes,
  /Advanced compatibility metadata normally supplied by deployment\/tooling/
);

for (
  const rejectedCoreConcept
  of [
    "Approval",
    "Tenant",
    "Memory",
    "Skill",
    "Package",
    "Agent",
    "Surface"
  ]
) {
  assert.match(
    audit,
    new RegExp(
      `\\b${rejectedCoreConcept}\\b`
    )
  );
}

assert.match(
  audit,
  /Core primitive additions required: 0/
);

assert.match(
  audit,
  /do not add another UI abstraction/
);

console.log(
  JSON.stringify(
    {
      readmeHistoricalNoise:
        "REMOVED",
      explicitInitialVersion:
        "NOT_REQUIRED",
      stableIds:
        "REQUIRED",
      preferredUiApi: [
        "surface",
        "input",
        "choose",
        "present"
      ],
      legacyUiApi:
        "DEPRECATED",
      workflowDeploymentMetadata:
        "ADVANCED_ONLY",
      newCorePrimitives:
        0
    },
    null,
    2
  )
);

console.log(
  "UAIR pre-v1 API/DX complexity audit: PASS"
);
