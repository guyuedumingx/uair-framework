import assert from "node:assert/strict";
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
  run,
  RuntimeEngine
} from "../packages/core/dist/index.js";

import {
  JsonFileStorage
} from "../packages/core/dist/runtime-api.js";

import {
  input,
  choose,
  listPendingUi,
  uiResultEvent,
  toSurfaceDocument,
  isSurfaceDocument,
  SurfaceRendererRegistry
} from "../packages/ui/dist/index.js";

const doc =
  toSurfaceDocument({
    kind:
      "customer.list",
    title:
      "Customers",
    data: {
      items: [
        "A",
        "B"
      ]
    }
  });

assert.equal(
  doc.protocol,
  "uair.surface/v1"
);

assert.equal(
  isSurfaceDocument(doc),
  true
);

const registry =
  new SurfaceRendererRegistry();

registry.register(
  "customer.list",
  spec =>
    `render:${spec.kind}:${spec.data.items.length}`
);

assert.equal(
  registry.render(doc),
  "render:customer.list:2"
);

const app =
  workflow({
    id:
      "ui.surface.check",

    async run() {
      const name =
        await input({
          prompt:
            "Your name?",
          modes: [
            "text",
            "voice"
          ]
        });

      const choice =
        await choose({
          title:
            "Choose account",
          items: [
            {
              id:
                "a",
              label:
                "Account A",
              value:
                "account-a"
            },
            {
              id:
                "b",
              label:
                "Account B",
              value:
                "account-b"
            }
          ]
        });

      return {
        name:
          name.value,
        account:
          choice.selected[0]
      };
    }
  });

const dir =
  await mkdtemp(
    join(
      tmpdir(),
      "uair-ui-surface-"
    )
  );

const previousCwd =
  process.cwd();

try {
  // RuntimeEngine default inbox/outbox/receipt stores are relative-path
  // stores. Keep them inside this test's temp directory so event IDs from a
  // previous test/preflight run cannot make this run order-dependent.
  process.chdir(dir);

  const storage =
    new JsonFileStorage(
      join(
        dir,
        "state"
      )
    );

  const engine =
    new RuntimeEngine(
      storage,
      [
        app
      ]
    );

  const created =
    await run(
      app,
      undefined,
      storage
    );

  assert.equal(
    created.status,
    "suspended"
  );

  let pending =
    await listPendingUi(
      storage
    );

  assert.equal(
    pending.length,
    1
  );

  assert.equal(
    pending[0].component,
    "Input"
  );

  await engine.emit(
    uiResultEvent({
      eventId:
        "input-1",
      suspensionId:
        pending[0]
          .suspensionId,
      value: {
        value:
          "Alice",
        mode:
          "text"
      }
    })
  );

  pending =
    await listPendingUi(
      storage
    );

  assert.equal(
    pending.length,
    1
  );

  assert.equal(
    pending[0].component,
    "Choose"
  );

  await engine.emit(
    uiResultEvent({
      eventId:
        "choose-1",
      suspensionId:
        pending[0]
          .suspensionId,
      value: {
        selected: [
          "account-b"
        ],
        ids: [
          "b"
        ]
      }
    })
  );

  const completed =
    await storage
      .loadExecution(
        created.id
      );

  assert.equal(
    completed?.status,
    "completed"
  );

  assert.deepEqual(
    completed?.result,
    {
      name:
        "Alice",
      account:
        "account-b"
    }
  );

  console.log(
    "UAIR Surface protocol + input/choose durability verification: PASS"
  );
} finally {
  process.chdir(
    previousCwd
  );

  await rm(
    dir,
    {
      recursive: true,
      force: true
    }
  );
}
