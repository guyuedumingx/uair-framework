import assert from "node:assert/strict";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import {
  ExtensionController,
  FunctionExtensionAdapter
} from "../packages/builder/dist/index.js";
import {
  TrustedPackageAcquirer
} from "../packages/sandbox/dist/index.js";
import {
  staticTrustPolicy
} from "../packages/security/dist/index.js";

const runs = [];

const runner = {
  async run(input) {
    runs.push(input);

    const spec = input.args.at(-1);
    const packageName = spec.startsWith("@")
      ? spec.split("@").slice(0, 2).join("@")
      : spec.split("@")[0];

    const packageDir = join(
      input.cwd,
      "node_modules",
      packageName
    );

    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: packageName,
        version: "2.4.0",
        type: "module"
      }),
      "utf8"
    );

    return {
      exitCode: 0,
      stdout: "installed",
      stderr: ""
    };
  }
};

const trust = staticTrustPolicy([
  {
    packageName: "@acme/attendance-kit",
    allowedVersions: ["2.4.0"],
    allowLifecycleScripts: false,
    allowNativeAddons: false,
    network: "registry-only",
    filesystem: "isolated",
    allowedSecrets: []
  }
]);

const acquirer = new TrustedPackageAcquirer(
  trust,
  runner
);

const controller = new ExtensionController({
  stateDir: join(
    process.cwd(),
    ".tmp-self-extension-trusted"
  ),
  adapter: new FunctionExtensionAdapter(
    async action => {
      const installed = await acquirer.acquire({
        packageName: action.packageName,
        version: action.version,
        requestedCapability: action.capabilityId
      });

      return {
        evidence: {
          installDir: installed.installDir,
          sandbox: true,
          network: installed.evidence?.network,
          filesystem: installed.evidence?.filesystem
        }
      };
    }
  )
});

try {
  await controller.saveProposal({
    packageName: "@acme/leave",
    version: "0.1.0",
    artifacts: [],
    preview: {
      packageName: "@acme/leave",
      entryWorkflow: "hr.leave.request",
      surfaces: [],
      capabilities: [],
      demoScenarios: []
    },
    verification: { passed: true, checks: [] },
    impact: {
      activeExecutionRisk: "none",
      versionRecommendation: "1",
      notes: []
    },
    extensionPlan: {
      required: true,
      actions: [
        {
          capabilityId: "attendance.update",
          kind: "install-package",
          packageName: "@acme/attendance-kit",
          version: "2.4.0"
        }
      ]
    },
    permissions: []
  });

  await assert.rejects(
    () => controller.apply(false),
    /explicit approval/
  );

  const applied = await controller.apply(true);
  assert.equal(applied.length, 1);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].command, "npm");
  assert.equal(runs[0].network, "registry-only");
  assert.equal(runs[0].filesystem, "isolated");
  assert.equal(
    runs[0].args.includes("--ignore-scripts"),
    true,
    "untrusted lifecycle scripts must be disabled by default"
  );

  await controller.apply(true);
  assert.equal(
    runs.length,
    1,
    "approved acquisition is idempotent"
  );

  const deniedAcquirer = new TrustedPackageAcquirer(
    staticTrustPolicy([]),
    runner
  );

  await assert.rejects(
    () => deniedAcquirer.acquire({
      packageName: "@evil/untrusted",
      version: "1.0.0",
      requestedCapability: "evil.capability"
    }),
    /not on the trusted package allowlist/
  );

  console.log(JSON.stringify({
    explicitApproval: "PASS",
    trustPolicy: "PASS",
    sandboxRunner: "PASS",
    lifecycleScriptsDisabled: "PASS",
    restrictedNetwork: "PASS",
    isolatedFilesystem: "PASS",
    untrustedPackageDenied: "PASS",
    idempotentAcquisition: "PASS"
  }, null, 2));

  console.log(
    "UAIR trusted extension acquisition verification: PASS"
  );
} finally {
  const { rm } = await import("node:fs/promises");
  await rm(
    join(process.cwd(), ".tmp-self-extension-trusted"),
    { recursive: true, force: true }
  );
}
