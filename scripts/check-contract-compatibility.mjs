import assert from "node:assert/strict";
import {
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
  analyzeContractCompatibility,
  buildProjectGraph
} from "../packages/builder/dist/index.js";

async function project(
  root,
  {
    inputRegion,
    keepTier,
    surfaceDepartment,
    actionComment = false
  }
) {
  await mkdir(
    join(root, "src"),
    {
      recursive: true
    }
  );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "@acme/contracts",
        version: "1.0.0",
        type: "module"
      },
      null,
      2
    )
  );

  const region =
    inputRegion === "none"
      ? ""
      : inputRegion === "optional"
        ? "region?: string;"
        : "region: string;";

  const tier =
    keepTier
      ? `tier: "A" as string,`
      : "";

  const department =
    surfaceDepartment
      ? `departmentId: input.departmentId,`
      : "";

  const inputType =
    surfaceDepartment
      ? `{
          employeeId: string;
          days: number;
          departmentId: string;
        }`
      : `{
          employeeId: string;
          days: number;
        }`;

  await writeFile(
    join(root, "src", "app.ts"),
    `
import {
  component,
  workflow
} from "@uair/core";

import {
  surface
} from "@uair/ui";

export const customerLoad =
  component({
    id:
      "crm.customer.load",

    async run(input: {
      id: string;
      ${region}
    }) {
      return {
        name:
          "Star",
        ${tier}
      };
    }
  });

type ApprovalData = {
  employeeId: string;
  days: number;
  ${surfaceDepartment ? "departmentId: string;" : ""}
};

type ApprovalValue = {
  approved: boolean;
  ${actionComment ? "comment: string;" : ""}
};

export const leave =
  workflow({
    id:
      "hr.leave.request",
    version:
      "3",

    async run(input: ${inputType}) {
      await customerLoad({
        id:
          input.employeeId
      });

      return surface<
        ApprovalData,
        ApprovalValue
      >({
        kind:
          "hr.leave.manager-approval",
        data: {
          employeeId:
            input.employeeId,
          days:
            input.days,
          ${department}
        }
      });
    }
  });
`
  );
}

const beforeDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-contract-before-"
    )
  );

const compatibleDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-contract-compatible-"
    )
  );

const inputBreakDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-contract-input-break-"
    )
  );

const outputBreakDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-contract-output-break-"
    )
  );

const surfaceBreakDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-contract-surface-break-"
    )
  );

const actionBreakDir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-contract-action-break-"
    )
  );

try {
  await project(
    beforeDir,
    {
      inputRegion: "none",
      keepTier: true,
      surfaceDepartment: false
    }
  );

  await project(
    compatibleDir,
    {
      inputRegion: "optional",
      keepTier: true,
      surfaceDepartment: false
    }
  );

  await project(
    inputBreakDir,
    {
      inputRegion: "required",
      keepTier: true,
      surfaceDepartment: false
    }
  );

  await project(
    outputBreakDir,
    {
      inputRegion: "none",
      keepTier: false,
      surfaceDepartment: false
    }
  );

  await project(
    surfaceBreakDir,
    {
      inputRegion: "none",
      keepTier: true,
      surfaceDepartment: true
    }
  );

  await project(
    actionBreakDir,
    {
      inputRegion: "none",
      keepTier: true,
      surfaceDepartment: false,
      actionComment: true
    }
  );

  const before =
    await buildProjectGraph(
      beforeDir
    );

  const component =
    before.nodes.find(
      node =>
        node.key ===
        "component:crm.customer.load"
    );

  const surface =
    before.nodes.find(
      node =>
        node.key ===
        "surface:hr.leave.manager-approval"
    );

  assert.equal(
    component?.contract?.input?.kind,
    "object"
  );

  assert.equal(
    component?.contract?.output?.kind,
    "object"
  );

  assert.equal(
    surface?.contract?.data?.kind,
    "object"
  );

  assert.equal(
    surface?.contract?.action?.kind,
    "object"
  );

  const compatible =
    analyzeContractCompatibility(
      before,
      await buildProjectGraph(
        compatibleDir
      )
    );

  assert.equal(
    compatible.compatible,
    true
  );

  const inputBreak =
    analyzeContractCompatibility(
      before,
      await buildProjectGraph(
        inputBreakDir
      )
    );

  assert.equal(
    inputBreak.compatible,
    false
  );

  assert.equal(
    inputBreak.issues.some(
      issue =>
        issue.code ===
        "INPUT_CONTRACT_NARROWED" &&
        issue.message.includes(
          "region"
        )
    ),
    true
  );

  const outputBreak =
    analyzeContractCompatibility(
      before,
      await buildProjectGraph(
        outputBreakDir
      )
    );

  assert.equal(
    outputBreak.compatible,
    false
  );

  assert.equal(
    outputBreak.issues.some(
      issue =>
        issue.code ===
        "OUTPUT_CONTRACT_BROKEN" &&
        issue.message.includes(
          "tier"
        )
    ),
    true
  );

  const actionBreak =
    analyzeContractCompatibility(
      before,
      await buildProjectGraph(
        actionBreakDir
      )
    );

  assert.equal(
    actionBreak.compatible,
    false
  );

  assert.equal(
    actionBreak.issues.some(
      issue =>
        issue.code ===
        "SURFACE_ACTION_CONTRACT_NARROWED" &&
        issue.message.includes(
          "comment"
        )
    ),
    true
  );

  const surfaceAfter =
    await buildProjectGraph(
      surfaceBreakDir
    );

  const surfaceBreak =
    analyzeContractCompatibility(
      before,
      surfaceAfter,
      [
        {
          kind:
            "hr.leave.manager-approval",
          data: {
            employeeId:
              "E1001",
            days:
              2
          }
        }
      ]
    );

  assert.equal(
    surfaceBreak.compatible,
    false
  );

  assert.equal(
    surfaceBreak.issues.some(
      issue =>
        issue.code ===
        "SURFACE_DATA_CONTRACT_NARROWED" &&
        issue.message.includes(
          "departmentId"
        )
    ),
    true
  );

  assert.equal(
    surfaceBreak.issues.some(
      issue =>
        issue.code ===
        "PENDING_SURFACE_PAYLOAD_INCOMPATIBLE"
    ),
    true
  );

  assert.equal(
    surfaceBreak
      .runtimePayloadChecks[0]
      .samples,
    1
  );

  assert.equal(
    surfaceBreak
      .runtimePayloadChecks[0]
      .compatible,
    false
  );

  console.log(
    JSON.stringify(
      {
        componentContract:
          component.contract,
        surfaceContract:
          surface.contract,
        compatible:
          compatible.compatible,
        inputBreak:
          inputBreak.issues,
        outputBreak:
          outputBreak.issues,
        actionBreak:
          actionBreak.issues,
        surfaceBreak:
          surfaceBreak.issues,
        runtimePayloadChecks:
          surfaceBreak
            .runtimePayloadChecks
      },
      null,
      2
    )
  );

  console.log(
    "UAIR Contract Graph + compatibility verification: PASS"
  );
} finally {
  for (
    const dir
    of [
      beforeDir,
      compatibleDir,
      inputBreakDir,
      outputBreakDir,
      surfaceBreakDir,
      actionBreakDir
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
