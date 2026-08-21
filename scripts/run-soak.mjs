import {
  spawnSync
} from "node:child_process";

function option(
  name,
  fallback
) {
  const index =
    process.argv.indexOf(
      name
    );

  if (
    index === -1
  ) {
    return fallback;
  }

  const value =
    Number(
      process.argv[
        index + 1
      ]
    );

  if (
    !Number.isInteger(
      value
    ) ||
    value <= 0
  ) {
    throw new Error(
      `${name} must be a positive integer`
    );
  }

  return value;
}

const cycles =
  option(
    "--cycles",
    Number(
      process.env
        .UAIR_SOAK_CYCLES ??
      100
    )
  );

const startedAt =
  Date.now();

const baseSeed =
  Number(
    process.env
      .UAIR_SOAK_SEED ??
    0x51a0cafe
  ) >>> 0;

const run =
  (
    script,
    cycle
  ) => {
    const result =
      spawnSync(
        "npm",
        [
          "run",
          script,
          "--silent"
        ],
        {
          cwd:
            process.cwd(),
          stdio:
            "inherit",
          env: {
            ...process.env,
            ...(
              script ===
                "chaos"
                ? {
                    UAIR_CHAOS_SEED:
                      String(
                        (
                          baseSeed +
                          cycle
                        ) >>> 0
                      ),
                    UAIR_CHAOS_EXECUTIONS_PER_VERSION:
                      process.env
                        .UAIR_SOAK_EXECUTIONS_PER_VERSION ??
                      process.env
                        .UAIR_CHAOS_EXECUTIONS_PER_VERSION ??
                      "8"
                  }
                : {}
            )
          }
        }
      );

    if (
      result.status !== 0
    ) {
      throw new Error(
        `Soak cycle ${cycle}: ${script} failed with code ${result.status}`
      );
    }
  };

for (
  let cycle = 1;
  cycle <= cycles;
  cycle += 1
) {
  console.log(
    `\n=== UAIR soak cycle ${cycle}/${cycles} ===`
  );

  run(
    "chaos",
    cycle
  );

  run(
    "check:queue-faults",
    cycle
  );

  run(
    "check:suspension-race",
    cycle
  );

  if (
    cycle === 1 ||
    cycle % 10 === 0 ||
    cycle === cycles
  ) {
    run(
      "check:sqlite-adversarial",
      cycle
    );
  }
}

const finishedAt =
  Date.now();

console.log(
  JSON.stringify(
    {
      cycles,
      baseSeed,
      startedAt,
      finishedAt,
      durationMs:
        finishedAt -
        startedAt,
      result:
        "PASS"
    },
    null,
    2
  )
);

console.log(
  "UAIR local durability soak verification: PASS"
);
