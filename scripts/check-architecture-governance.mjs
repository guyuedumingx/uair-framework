import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
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
  analyzeProjectGovernance,
  analyzeProjectImpact,
  buildProjectGraph,
  renderProjectGraphMermaid
} from "../packages/builder/dist/index.js";

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-governance-"
    )
  );

try {
  const packageA =
    join(
      dir,
      "packages",
      "order"
    );

  const packageB =
    join(
      dir,
      "packages",
      "payment"
    );

  await mkdir(
    join(
      packageA,
      "src"
    ),
    {
      recursive:
        true
    }
  );

  await mkdir(
    join(
      packageB,
      "src",
      "internal"
    ),
    {
      recursive:
        true
    }
  );

  await writeFile(
    join(
      packageA,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "@acme/order",
        version:
          "1.0.0",
        type:
          "module",
        dependencies: {
          "@acme/payment":
            "1.0.0"
        }
      },
      null,
      2
    )
  );

  await writeFile(
    join(
      packageB,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "@acme/payment",
        version:
          "1.0.0",
        type:
          "module",
        exports: {
          ".":
            "./src/payment.ts",
          "./internal":
            "./src/internal/refund.ts"
        },
        dependencies: {
          "@acme/order":
            "1.0.0"
        }
      },
      null,
      2
    )
  );

  await writeFile(
    join(
      packageA,
      "src",
      "order.ts"
    ),
    `
import {
  workflow,
  component
} from "@uair/core";

import {
  unsafeRefund
} from "@acme/payment/src/internal/refund.js";

import {
  unsafeRefund as exportedRefund
} from "@acme/payment/internal";

export const checkout =
  workflow(
    "commerce.checkout",
    async input =>
      exportedRefund(
        await unsafeRefund(input)
      )
  );

export const checkoutV2 =
  workflow(
    "commerce.checkout",
    {
      version: "2"
    },
    async input =>
      exportedRefund(input)
  );

export const duplicate =
  component(
    "shared.duplicate",
    async input =>
      input
  );
`
  );

  await writeFile(
    join(
      packageB,
      "src",
      "payment.ts"
    ),
    `
import {
  component
} from "@uair/core";

export const duplicate =
  component(
    "shared.duplicate",
    async input =>
      input
  );
`
  );

  await writeFile(
    join(
      packageB,
      "src",
      "internal",
      "refund.ts"
    ),
    `
export async function unsafeRefund(
  input: unknown
) {
  return input;
}
`
  );

  const graph =
    await buildProjectGraph(
      dir
    );

  const governance =
    await analyzeProjectGovernance(
      graph,
      {
        packageNamespaces: {
          "@acme/order":
            "order.",
          "@acme/payment":
            "payment."
        }
      }
    );

  assert.equal(
    graph.nodes.find(
      node =>
        node.key ===
          "workflow:commerce.checkout"
    )?.version,
    "2",
    "ProjectGraph keeps the newest declared Workflow version as the canonical node"
  );

  const codes =
    new Set(
      governance.issues.map(
        issue =>
          issue.code
      )
    );

  assert.equal(
    governance.healthy,
    false
  );

  assert.equal(
    codes.has(
      "DUPLICATE_DURABLE_ID"
    ),
    true
  );

  assert.equal(
    codes.has(
      "PACKAGE_DEPENDENCY_CYCLE"
    ),
    true
  );

  assert.equal(
    codes.has(
      "CROSS_PACKAGE_PRIVATE_IMPORT"
    ),
    true
  );

  assert.equal(
    governance.issues.filter(
      issue =>
        issue.code ===
          "CROSS_PACKAGE_PRIVATE_IMPORT"
    ).length,
    1,
    "declared package export subpaths are public even when their name contains internal"
  );

  assert.equal(
    governance.issues.some(
      issue =>
        issue.code ===
          "DUPLICATE_DURABLE_ID" &&
        issue.nodeKey ===
          "workflow:commerce.checkout"
    ),
    false,
    "distinct Workflow versions share one durable ID without becoming duplicate declarations"
  );

  assert.equal(
    codes.has(
      "PACKAGE_NAMESPACE_MISMATCH"
    ),
    true,
    "namespace policy is optional, but enforced when supplied"
  );

  const manualGraph = {
    rootDir:
      dir,
    nodes: [
      {
        key:
          "package:@acme/commerce",
        kind:
          "package",
        id:
          "@acme/commerce"
      },
      {
        key:
          "workflow:commerce.checkout",
        kind:
          "workflow",
        id:
          "commerce.checkout",
        version:
          "2",
        packageName:
          "@acme/commerce"
      },
      {
        key:
          "workflow:commerce.fulfillment",
        kind:
          "workflow",
        id:
          "commerce.fulfillment",
        version:
          "1",
        packageName:
          "@acme/commerce"
      },
      {
        key:
          "component:payment.charge",
        kind:
          "component",
        id:
          "payment.charge",
        packageName:
          "@acme/payment"
      },
      {
        key:
          "component:inventory.reserve",
        kind:
          "component",
        id:
          "inventory.reserve",
        packageName:
          "@acme/inventory"
      }
    ],
    edges: [
      {
        from:
          "package:@acme/commerce",
        to:
          "workflow:commerce.checkout",
        kind:
          "contains"
      },
      {
        from:
          "workflow:commerce.checkout",
        to:
          "component:payment.charge",
        kind:
          "uses"
      },
      {
        from:
          "workflow:commerce.checkout",
        to:
          "workflow:commerce.fulfillment",
        kind:
          "uses"
      },
      {
        from:
          "workflow:commerce.fulfillment",
        to:
          "component:inventory.reserve",
        kind:
          "uses"
      }
    ]
  };

  const impact =
    analyzeProjectImpact(
      manualGraph,
      "component:inventory.reserve"
    );

  assert.deepEqual(
    new Set(
      impact
        .transitivelyAffected
        .map(
          node =>
            node.id
        )
    ),
    new Set([
      "commerce.fulfillment",
      "commerce.checkout",
      "@acme/commerce"
    ])
  );

  assert.equal(
    impact.paths
      .some(
        path =>
          path.target.id ===
            "commerce.checkout" &&
          path.path
            .map(
              node =>
                node.id
            )
            .join(" > ") ===
            "inventory.reserve > commerce.fulfillment > commerce.checkout"
      ),
    true
  );

  const mermaid =
    renderProjectGraphMermaid(
      manualGraph
    );

  assert.match(
    mermaid,
    /^flowchart LR/m
  );

  assert.match(
    mermaid,
    /workflow: commerce\.checkout@2/
  );

  assert.match(
    mermaid,
    /payment\.charge/
  );

  const cycleGraph = {
    ...manualGraph,
    edges: [
      ...manualGraph.edges,
      {
        from:
          "workflow:commerce.fulfillment",
        to:
          "workflow:commerce.checkout",
        kind:
          "uses"
      }
    ]
  };

  const cycleReport =
    await analyzeProjectGovernance(
      cycleGraph
    );

  assert.equal(
    cycleReport.issues
      .some(
        issue =>
          issue.code ===
            "WORKFLOW_DEPENDENCY_CYCLE"
      ),
    true
  );

  const highFanOutGraph = {
    rootDir:
      dir,
    nodes: [
      {
        key:
          "workflow:big.workflow",
        kind:
          "workflow",
        id:
          "big.workflow",
        version:
          "1"
      },
      ...Array.from(
        {
          length:
            4
        },
        (
          _,
          index
        ) => ({
          key:
            `component:c${index}`,
          kind:
            "component",
          id:
            `c${index}`
        })
      )
    ],
    edges:
      Array.from(
        {
          length:
            4
        },
        (
          _,
          index
        ) => ({
          from:
            "workflow:big.workflow",
          to:
            `component:c${index}`,
          kind:
            "uses"
        })
      )
  };

  const smell =
    await analyzeProjectGovernance(
      highFanOutGraph,
      {
        maxDirectUses:
          3
      }
    );

  assert.equal(
    smell.healthy,
    true,
    "architecture smells warn but do not become hard correctness errors"
  );

  assert.equal(
    smell.issues
      .some(
        issue =>
          issue.code ===
            "HIGH_WORKFLOW_FAN_OUT" &&
          issue.severity ===
            "warning"
      ),
    true
  );

  console.log(
    JSON.stringify(
      {
        hardErrors: {
          duplicateDurableId:
            "PASS",
          packageCycle:
            "PASS",
          privateDeepImport:
            "PASS"
        },
        optionalPolicy: {
          namespace:
            "PASS"
        },
        smells: {
          highFanOutWarning:
            "PASS"
        },
        impactAnalysis:
          "PASS",
        workflowCycle:
          "PASS",
        mermaidProjection:
          "PASS",
        coreChanges:
          0
      },
      null,
      2
    )
  );

  console.log(
    "UAIR architecture governance verification: PASS"
  );
} finally {
  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
