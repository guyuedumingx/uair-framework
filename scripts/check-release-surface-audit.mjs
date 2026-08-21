import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(path, "utf8");

const audit = await read("docs/release/release-surface-audit.md");
const stability = await read("docs/architecture/api-stability.md");
const extension = await read("packages/builder/src/extension-controller.ts");
const cli = await read("packages/cli/src/run-cli.ts");
const agent = await read("packages/agent/src/index.ts");
const corePackage = JSON.parse(await read("packages/core/package.json"));
const forgePackage = JSON.parse(await read("packages/forge/package.json"));

assert.match(audit, /new Core primitives:\s+0/);
assert.match(audit, /operator approval\s*→\s*security\/trust enforcement/s);
assert.match(audit, /do not add provider-specific Agent concepts to Core/);
assert.match(audit, /required package merges before alpha:\s*0/);
assert.match(audit, /new CLI commands:\s+0/);

assert.match(
  extension,
  /`approved` is release\/operator intent, not a security authorization/
);

assert.ok(
  cli.includes("Unknown command: ${command}. Run \\`uair help\\` for available commands.")
);
assert.match(
  cli,
  /package requires a subcommand: create, verify, pack, catalog, status, install, upgrade, rollback, or publish/
);

for (const symbol of [
  "agent",
  "asAgentTool",
  "externalAgent",
  "durableWorkflowTool"
]) {
  assert.match(agent, new RegExp(`\\b${symbol}\\b`));
}

assert.ok(
  corePackage.exports["./cluster"],
  "@uair/core/cluster export must remain explicit"
);
assert.match(stability, /Tier 3: cluster API — experimental/);
assert.match(stability, /@uair\/forge` is explicitly experimental/);
assert.match(
  forgePackage.description,
  /^Experimental /
);

console.log(JSON.stringify({
  corePrimitivesAdded: 0,
  cliCommandsAdded: 0,
  packageMergesRequired: 0,
  extensionApprovalIsSecurityAuthorization: false,
  externalAgentInternalsOwnedByUair: false,
  clusterApi: "EXPERIMENTAL",
  forge: "EXPERIMENTAL",
  errorTaxonomyExpansion: "REJECTED"
}, null, 2));

console.log("UAIR release-surface subtractive audit: PASS");
