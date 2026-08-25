import {
  spawnSync
} from "node:child_process";

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
  "npm",
  [
    "run",
    "clean"
  ]
);

run(
  "npm",
  [
    "run",
    "build"
  ]
);

run(
  "npm",
  [
    "run",
    "check:mcp-invocation-sqlite"
  ]
);

run(
  "npm",
  [
    "run",
    "release:preflight"
  ]
);

console.log(
  "\nUAIR clean release check: PASS"
);
