import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

import {
  buildProjectGraph,
  createChangeSet,
  analyzeChangeSetSafety
} from "../packages/builder/dist/index.js";

async function makeProject(
  root,
  {
    version,
    threshold,
    includeBalance = true
  }
) {
  await mkdir(
    join(root, "src"),
    {
      recursive: true
    }
  );

  await writeFile(
    join(
      root,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "@acme/leave",
        version:
          "1.0.0",
        type:
          "module"
      },
      null,
      2
    )
  );

  await writeFile(
    join(
      root,
      "src",
      "components.ts"
    ),
    includeBalance
      ? `
import {
  component
} from "@uair/core";

export const checkBalance =
  component({
    id:
      "leave.balance.read",

    async run() {
      return {
        remaining: 12
      };
    }
  });
`
      : `
export const removed = true;
`
  );

  await writeFile(
    join(
      root,
      "src",
      "workflow.ts"
    ),
    `
import {
  workflow
} from "@uair/core";

import {
  surface
} from "@uair/ui";

${
  includeBalance
    ? `import {
  checkBalance
} from "./components.js";`
    : ""
}

export const leave =
  workflow({
    id:
      "hr.leave.request",
    version:
      "${version}",

    async run(input) {
      ${
        includeBalance
          ? "await checkBalance();"
          : ""
      }

      if (
        input.days >
          ${threshold}
      ) {
        return surface({
          kind:
            "hr.leave.director-approval",
          data: {
            input
          }
        });
      }

      return {
        approved: true
      };
    }
  });
`
  );
}

const beforeDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-change-before-"
    )
  );

const safeAfterDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-change-safe-"
    )
  );

const unsafeAfterDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-change-unsafe-"
    )
  );

const removalDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-change-remove-"
    )
  );

try {
  await makeProject(
    beforeDir,
    {
      version:
        "2",
      threshold:
        3
    }
  );

  await makeProject(
    safeAfterDir,
    {
      version:
        "3",
      threshold:
        2
    }
  );

  await makeProject(
    unsafeAfterDir,
    {
      version:
        "2",
      threshold:
        2
    }
  );

  await makeProject(
    removalDir,
    {
      version:
        "3",
      threshold:
        2,
      includeBalance:
        false
    }
  );

  const before =
    await buildProjectGraph(
      beforeDir
    );

  const workflow =
    before.nodes
      .find(
        node =>
          node.key ===
          "workflow:hr.leave.request"
      );

  const balance =
    before.nodes
      .find(
        node =>
          node.key ===
          "component:leave.balance.read"
      );

  assert.ok(workflow);
  assert.ok(balance);

  assert.equal(
    before.edges.some(
      edge =>
        edge.from ===
          workflow.key &&
        edge.to ===
          balance.key &&
        edge.kind ===
          "uses"
    ),
    true,
    "Workflow must symbolically use imported Component"
  );

  assert.equal(
    before.edges.some(
      edge =>
        edge.from ===
          workflow.key &&
        edge.to ===
          "surface:hr.leave.director-approval" &&
        edge.kind ===
          "uses"
    ),
    true,
    "Workflow must use semantic Surface"
  );

  const safeAfter =
    await buildProjectGraph(
      safeAfterDir
    );

  const safeChange =
    createChangeSet(
      before,
      safeAfter
    );

  const safeReport =
    analyzeChangeSetSafety(
      safeChange
    );

  assert.equal(
    safeChange.items
      .some(
        item =>
          item.kind ===
            "workflow" &&
          item.id ===
            "hr.leave.request" &&
          item.change ===
            "modify"
      ),
    true
  );

  assert.equal(
    safeReport.safe,
    true
  );

  assert.equal(
    safeReport.issues.some(
      issue =>
        issue.code ===
          "WORKFLOW_VERSION_ADVANCED"
    ),
    true
  );

  const unsafeAfter =
    await buildProjectGraph(
      unsafeAfterDir
    );

  const unsafeReport =
    analyzeChangeSetSafety(
      createChangeSet(
        before,
        unsafeAfter
      )
    );

  assert.equal(
    unsafeReport.safe,
    false
  );

  assert.equal(
    unsafeReport.issues.some(
      issue =>
        issue.code ===
          "WORKFLOW_IMPLEMENTATION_CHANGED_WITHOUT_VERSION_BUMP"
    ),
    true
  );

  const removal =
    createChangeSet(
      before,
      await buildProjectGraph(
        removalDir
      )
    );

  const removedBalance =
    removal.items.find(
      item =>
        item.change ===
          "remove" &&
        item.id ===
          "leave.balance.read"
    );

  assert.ok(
    removedBalance
  );

  assert.equal(
    removedBalance.affected.some(
      item =>
        item.kind ===
          "workflow" &&
        item.id ===
          "hr.leave.request"
    ),
    true,
    "Removing a Component must identify dependent Workflow"
  );

  const removalReport =
    analyzeChangeSetSafety(
      removal
    );

  assert.equal(
    removalReport.safe,
    false
  );

  assert.equal(
    removalReport.issues.some(
      issue =>
        issue.code ===
          "REMOVAL_HAS_DEPENDENTS"
    ),
    true
  );

  console.log(
    JSON.stringify(
      {
        uses: before.edges
          .filter(
            edge =>
              edge.kind ===
              "uses"
          ),
        safeChange:
          safeChange.summary,
        safeIssues:
          safeReport.issues,
        unsafeIssues:
          unsafeReport.issues,
        removalAffected:
          removedBalance.affected
      },
      null,
      2
    )
  );

  console.log(
    "UAIR symbol ProjectGraph + ChangeSet verification: PASS"
  );
} finally {
  for (
    const dir
    of [
      beforeDir,
      safeAfterDir,
      unsafeAfterDir,
      removalDir
    ]
  ) {
    await rm(
      dir,
      {
        recursive: true,
        force: true
      }
    );
  }
}
