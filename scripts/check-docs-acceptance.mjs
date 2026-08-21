import assert from "node:assert/strict";
import {
  access,
  readFile
} from "node:fs/promises";
import {
  join
} from "node:path";

const required = [
  "README.md",
  "docs/README.md",
  "docs/getting-started/quick-start.md",
  "docs/getting-started/core-concepts.md",
  "docs/getting-started/mental-model.md",
  "docs/guides/business-workflow.md",
  "docs/guides/interactive-agent.md",
  "docs/guides/interactive-agent-reference.md",
  "docs/guides/existing-system.md",
  "docs/guides/package-development.md",
  "docs/guides/package-lifecycle.md",
  "docs/guides/production.md",
  "docs/guides/enterprise-project.md",
  "docs/maintainers/architecture-boundaries.md",
  "docs/maintainers/durable-contracts.md",
  "docs/maintainers/adding-adapter.md",
  "docs/maintainers/adding-storage.md",
  "docs/maintainers/release-process.md",
  "docs/reference/package-map.md",
  "docs/reference/codeowners-example.md",
  "docs/acceptance/fresh-developer.md",
  "docs/acceptance/fresh-ai.md",
  "AGENTS.md",
  "AI_AUTHORING_GUIDE.md",
  "CONTRIBUTING.md",
  "docs/architecture/layers.md",
  "docs/concepts/durable-identity.md"
];

for (
  const file
  of required
) {
  await access(file);
}

const read =
  file =>
    readFile(
      file,
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

assert.match(
  readme,
  /docs\/README\.md/
);

assert.match(
  readme,
  /AGENTS\.md/
);

assert.match(
  readme,
  /CONTRIBUTING\.md/
);

assert.match(
  readme,
  /workflow\(\s*"commerce\.checkout"/s,
  "README first-screen code should teach compact native syntax"
);

assert.equal(
  readme.includes(
    currentVersion
  ),
  true,
  `README must identify current release candidate ${currentVersion}`
);

const docsIndex =
  await read(
    "docs/README.md"
  );

for (
  const section
  of [
    "Start here",
    "Guides",
    "Architecture",
    "Maintainers",
    "Acceptance"
  ]
) {
  assert.match(
    docsIndex,
    new RegExp(
      section
    )
  );
}

const mental =
  await read(
    "docs/getting-started/mental-model.md"
  );

assert.match(
  mental,
  /(?:ordinary|normal) TypeScript function/
);

assert.match(
  mental,
  /domain package, not Core/
);

const agents =
  await read(
    "AGENTS.md"
  );

for (
  const rule
  of [
    "Core stays small",
    "Approval/OA is not Core",
    "Ordinary TypeScript stays ordinary TypeScript",
    "Never claim an environment-dependent test passed"
  ]
) {
  assert.match(
    agents,
    new RegExp(
      rule.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )
    )
  );
}

const ai =
  await read(
    "AI_AUTHORING_GUIDE.md"
  );

assert.match(
  ai,
  /Do not add domain concepts to `@uair\/core`/
);

assert.match(
  ai,
  /Use normal TypeScript functions/
);

assert.match(
  ai,
  /Never infer, rename or regenerate a durable ID/
);

const contributing =
  await read(
    "CONTRIBUTING.md"
  );

assert.match(
  contributing,
  /does not add a new Core primitive/
);

assert.match(
  contributing,
  /Old suspended Executions are considered/
);

const freshDeveloper =
  await read(
    "docs/acceptance/fresh-developer.md"
  );

assert.match(
  freshDeveloper,
  /does not modify `@uair\/core`/
);

assert.match(
  freshDeveloper,
  /pure helpers remain ordinary functions/
);

const freshAi =
  await read(
    "docs/acceptance/fresh-ai.md"
  );

assert.match(
  freshAi,
  /Hard fail/
);

assert.match(
  freshAi,
  /adds `Approval`, `Device`, `Inventory`, `User`, `Tenant` or `Skill` primitives/
);

assert.match(
  freshAi,
  /Core changes: none \/ justification/
);

const packageMap =
  await read(
    "docs/reference/package-map.md"
  );

assert.match(
  packageMap,
  /`@uair\/core` \| Core \| Yes/
);

assert.match(
  packageMap,
  /`@uair\/oa` \| Domain\/reference \| No/
);

const identity =
  await read(
    "docs/concepts/durable-identity.md"
  );

assert.match(
  identity,
  /Stable identity is mandatory in semantics, minimal in syntax/
);

console.log(
  JSON.stringify(
    {
      requiredDocuments:
        required.length,
      humanGoldenPath:
        "PASS",
      maintainerPath:
        "PASS",
      codingAgentRules:
        "PASS",
      freshDeveloperAcceptance:
        "READY",
      freshAiAcceptance:
        "READY",
      coreBoundaryMessaging:
        "PASS"
    },
    null,
    2
  )
);

console.log(
  "UAIR documentation information-architecture/acceptance gate: PASS"
);
