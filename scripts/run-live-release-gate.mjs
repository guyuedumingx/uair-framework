import {
  spawnSync
} from "node:child_process";

if (
  !process.env
    .DATABASE_URL
) {
  console.error(
    "LIVE RELEASE GATE FAIL: DATABASE_URL is required."
  );

  process.exit(2);
}

const run =
  (
    command,
    args
  ) => {
    console.log(
      `\n$ ${command} ${args.join(" ")}`
    );

    const result =
      spawnSync(
        command,
        args,
        {
          cwd:
            process.cwd(),
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
  };

run(
  "node",
  [
    "examples/postgres-integration/index.mjs"
  ]
);

run(
  "npm",
  [
    "run",
    "test:mcp-invocation-postgres"
  ]
);

run(
  "node",
  [
    "scripts/check-postgres-multiprocess.mjs"
  ]
);

run(
  "node",
  [
    "scripts/check-postgres-rolling-upgrade.mjs"
  ]
);

run(
  "node",
  [
    "scripts/run-soak.mjs",
    "--cycles",
    process.env
      .UAIR_LIVE_SOAK_CYCLES ??
    "20"
  ]
);

console.log(
  "\nUAIR live release environment gate: PASS"
);
