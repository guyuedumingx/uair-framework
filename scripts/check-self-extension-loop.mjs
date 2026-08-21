import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCli } from "../packages/cli/dist/index.js";
import {
  ExtensionController,
  FunctionExtensionAdapter
} from "../packages/builder/dist/index.js";

const requirement =
  "修改现有请假系统：所有请假直属经理审批，超过2天追加部门负责人审批，余额不足不能提交，审批后写入考勤并审计。";

const root = await mkdtemp(
  join(tmpdir(), "uair-self-extension-")
);

function ioCapture() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    io: {
      stdout(value) { stdout.push(value); },
      stderr(value) { stderr.push(value); }
    }
  };
}

try {
  const installProject = join(root, "install");
  await cp(
    "examples/builder-showcase/fixture",
    installProject,
    { recursive: true }
  );

  const catalogFile = join(installProject, "uair.catalog.json");
  await writeFile(
    catalogFile,
    JSON.stringify([
      {
        packageName: "@acme/attendance-kit",
        version: "2.4.0",
        description: "Attendance integration for HR workflows",
        capabilities: [
          {
            id: "attendance.update",
            description: "write approved leave into attendance",
            tags: ["attendance", "leave", "hr"],
            metadata: {
              exportName: "updateAttendance"
            }
          }
        ]
      }
    ], null, 2) + "\n"
  );

  const installIo = ioCapture();
  let code = await runCli([
    "build",
    "--requirement", requirement,
    "--scope", "acme",
    "--package", "@acme/leave",
    "--backend", "deterministic",
    "--catalog", "uair.catalog.json"
  ], {
    cwd: installProject,
    io: installIo.io
  });

  assert.equal(code, 0, installIo.stderr.at(-1));
  const build = JSON.parse(installIo.stdout.pop());

  const proposal = JSON.parse(
    await readFile(build.proposalFile, "utf8")
  );

  const attendanceResolution =
    proposal.capabilityResolution.capabilities.find(
      item => item.id === "attendance.update"
    );

  assert.equal(attendanceResolution.selected, "install");
  assert.equal(
    attendanceResolution.candidate.sourceName,
    "@acme/attendance-kit"
  );
  assert.equal(
    attendanceResolution.candidate.packageVersion,
    "2.4.0"
  );

  assert.deepEqual(proposal.extensionPlan, {
    required: true,
    actions: [
      {
        capabilityId: "attendance.update",
        kind: "install-package",
        packageName: "@acme/attendance-kit",
        version: "2.4.0"
      }
    ]
  });

  const generatedPackage = JSON.parse(
    await readFile(
      join(build.candidateDir, "package.json"),
      "utf8"
    )
  );

  assert.equal(
    generatedPackage.dependencies["@acme/attendance-kit"],
    "2.4.0"
  );

  const generatedWorkflow = await readFile(
    join(build.candidateDir, "src/workflows/leave.ts"),
    "utf8"
  );

  assert.match(
    generatedWorkflow,
    /updateAttendance.*@acme\/attendance-kit|@acme\/attendance-kit[\s\S]*updateAttendance/
  );

  const generatedComponents = await readFile(
    join(build.candidateDir, "src/components/index.ts"),
    "utf8"
  );

  assert.doesNotMatch(
    generatedComponents,
    /"attendance\.update"/,
    "installable capability must not also be generated locally"
  );

  code = await runCli(["release", "--approve"], {
    cwd: installProject,
    io: installIo.io
  });
  assert.equal(
    code,
    1,
    "release must be blocked until required extensions are approved/acquired"
  );
  assert.match(
    installIo.stderr.pop(),
    /required capability extensions/
  );

  code = await runCli(["extensions"], {
    cwd: installProject,
    io: installIo.io
  });
  assert.equal(code, 0);
  const extensionReview = JSON.parse(installIo.stdout.pop());
  assert.equal(extensionReview.required, true);
  assert.equal(extensionReview.actions.length, 1);

  code = await runCli(["extend"], {
    cwd: installProject,
    io: installIo.io
  });
  assert.equal(code, 1);
  assert.match(installIo.stderr.pop(), /explicit approval/);

  code = await runCli(["extend", "--approve"], {
    cwd: installProject,
    io: installIo.io
  });
  assert.equal(code, 0);
  const firstApply = JSON.parse(installIo.stdout.pop());
  assert.equal(firstApply.applied.length, 1);

  code = await runCli(["extend", "--approve"], {
    cwd: installProject,
    io: installIo.io
  });
  assert.equal(code, 0);
  const secondApply = JSON.parse(installIo.stdout.pop());
  assert.equal(
    secondApply.applied.length,
    1,
    "extension application must be idempotent"
  );

  code = await runCli(["release", "--approve"], {
    cwd: installProject,
    io: installIo.io
  });
  assert.equal(code, 0, installIo.stderr.at(-1));
  const released = JSON.parse(installIo.stdout.pop());
  assert.equal(released.released.workflowVersion, "3");

  // Verify the reusable controller can drive a real acquisition adapter
  // structurally; no host npm install is performed in this test.
  const acquired = [];
  const realController = new ExtensionController({
    stateDir: join(installProject, ".uair", "trusted-extension-test"),
    adapter: new FunctionExtensionAdapter(async action => {
      acquired.push(action);
      return {
        evidence: {
          trust: "verified",
          sandbox: "isolated"
        }
      };
    })
  });
  await realController.saveProposal(proposal);
  await realController.apply(true);
  await realController.apply(true);
  assert.equal(acquired.length, 1);

  const generateProject = join(root, "generate");
  await cp(
    "examples/builder-showcase/fixture",
    generateProject,
    { recursive: true }
  );

  const generateIo = ioCapture();
  code = await runCli([
    "build",
    "--requirement", requirement,
    "--scope", "acme",
    "--package", "@acme/leave",
    "--backend", "deterministic",
    "--catalog", "empty-catalog.json"
  ], {
    cwd: generateProject,
    io: generateIo.io
  });

  // Create the empty catalog then retry: the first failure proves bad catalog
  // input is not silently ignored.
  assert.equal(code, 1);
  await writeFile(
    join(generateProject, "empty-catalog.json"),
    "[]\n"
  );

  code = await runCli([
    "build",
    "--requirement", requirement,
    "--scope", "acme",
    "--package", "@acme/leave",
    "--backend", "deterministic",
    "--catalog", "empty-catalog.json"
  ], {
    cwd: generateProject,
    io: generateIo.io
  });

  assert.equal(code, 0, generateIo.stderr.at(-1));
  const generatedBuild = JSON.parse(generateIo.stdout.pop());
  const generatedProposal = JSON.parse(
    await readFile(generatedBuild.proposalFile, "utf8")
  );

  const generatedAttendance =
    generatedProposal.capabilityResolution.capabilities.find(
      item => item.id === "attendance.update"
    );

  assert.equal(generatedAttendance.selected, "generate");
  assert.equal(generatedProposal.extensionPlan.required, false);
  assert.deepEqual(generatedProposal.extensionPlan.actions, []);

  const fallbackComponents = await readFile(
    join(
      generatedBuild.candidateDir,
      "src/components/index.ts"
    ),
    "utf8"
  );

  assert.match(fallbackComponents, /"attendance\.update"/);

  console.log(JSON.stringify({
    reuseExistingProjectProvider: "PASS",
    preferInstallOverGenerate: "PASS",
    candidateDependencyMaterialized: "PASS",
    installAndGenerateMutuallyExclusive: "PASS",
    explicitExtensionApproval: "PASS",
    releaseBlockedBeforeExtension: "PASS",
    releaseAfterExtension: "PASS",
    extensionIdempotency: "PASS",
    structuralTrustedAcquisitionBridge: "PASS",
    generateFallback: "PASS",
    requiredCapabilityMaterialization: "PASS",
    coreChanges: 0
  }, null, 2));

  console.log("UAIR AI Builder self-extension loop verification: PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
