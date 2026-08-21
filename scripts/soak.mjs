import {
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  join
} from "node:path";
import {
  tmpdir
} from "node:os";

import {
  workflow,
  component,
  run
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

const total =
  Number(
    process.env.UAIR_SOAK_EXECUTIONS ??
      "10000"
  );

const concurrency =
  Number(
    process.env.UAIR_SOAK_CONCURRENCY ??
      "64"
  );

const root =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-soak-"
    )
  );

let effects = 0;

const work =
  component({
    id:
      "soak.effect",

    async run(input) {
      effects += 1;

      return {
        value:
          input.value + 1
      };
    }
  });

const app =
  workflow({
    id:
      "soak.workflow",
    version:
      "1",

    async run(input) {
      return work(
        input
      );
    }
  });

let next = 0;
let completed = 0;
const started =
  Date.now();

async function worker() {
  while (true) {
    const index =
      next++;

    if (
      index >= total
    ) {
      return;
    }

    const storage =
      new JsonFileStorage(
        join(
          root,
          String(index)
        )
      );

    const result =
      await run(
        app,
        {
          value:
            index
        },
        storage
      );

    if (
      result.value !==
        index + 1
    ) {
      throw new Error(
        `bad result at ${index}`
      );
    }

    completed += 1;
  }
}

try {
  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            concurrency,
            total
          )
      },
      () =>
        worker()
    )
  );

  const elapsedMs =
    Date.now() -
    started;

  if (
    completed !== total ||
    effects !== total
  ) {
    throw new Error(
      `soak mismatch: completed=${completed}, effects=${effects}, total=${total}`
    );
  }

  console.log(
    JSON.stringify(
      {
        executions:
          total,
        concurrency,
        completed,
        effects,
        elapsedMs,
        executionsPerSecond:
          Math.round(
            total /
              (
                elapsedMs /
                1000
              )
          )
      },
      null,
      2
    )
  );

  console.log(
    "UAIR soak verification: PASS"
  );
} finally {
  await rm(
    root,
    {
      recursive: true,
      force: true
    }
  );
}
