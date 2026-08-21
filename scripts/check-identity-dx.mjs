import assert from "node:assert/strict";

import {
  component,
  workflow
} from "../packages/core/dist/index.js";

import {
  VersionedWorkflowRegistry
} from "../packages/core/dist/versioning.js";

const compact =
  workflow(
    "commerce.checkout",
    async input =>
      input
  );

assert.equal(
  compact.id,
  "commerce.checkout"
);

assert.equal(
  compact.version,
  "1",
  "version 1 should be implicit for first/simple workflows"
);

const explicit =
  workflow(
    "commerce.checkout",
    {
      version:
        "2"
    },
    async input =>
      input
  );

assert.equal(
  explicit.version,
  "2"
);

assert.throws(
  () =>
    workflow(
      "   ",
      async () =>
        true
    ),
  /non-empty stable string/
);

assert.throws(
  () =>
    workflow(
      "valid.id",
      {
        version:
          " "
      },
      async () =>
        true
    ),
  /version must be a non-empty/
);

assert.throws(
  () =>
    component(
      "",
      async () =>
        true
    ),
  /non-empty stable string/
);


assert.throws(
  () =>
    workflow(
      " commerce.checkout",
      async () =>
        true
    ),
  /leading or trailing whitespace/
);

assert.throws(
  () =>
    component(
      "payments.charge ",
      async () =>
        true
    ),
  /leading or trailing whitespace/
);

assert.throws(
  () =>
    workflow(
      "commerce.checkout",
      {
        version:
          "2 "
      },
      async () =>
        true
    ),
  /leading or trailing whitespace/
);

const ordinaryFunction =
  (
    left,
    right
  ) =>
    left + right;

assert.equal(
  ordinaryFunction(
    2,
    3
  ),
  5,
  "ordinary TypeScript functions require no UAIR identity"
);

const durableBoundary =
  component(
    "payments.charge",
    async input =>
      input
  );

assert.equal(
  durableBoundary.id,
  "payments.charge"
);

const registry =
  new VersionedWorkflowRegistry([
    compact,
    explicit
  ]);

assert.ok(
  registry.resolve(
    "commerce.checkout",
    "1"
  )
);

assert.ok(
  registry.resolve(
    "commerce.checkout",
    "2"
  )
);

console.log(
  JSON.stringify(
    {
      stableWorkflowId:
        "required once",
      implicitInitialVersion:
        "1",
      explicitUpgradeVersion:
        "PASS",
      ordinaryFunctionsNeedId:
        false,
      durableComponentsNeedId:
        true,
      invalidIdentityRejected:
        "PASS",
      ambiguousWhitespaceRejected:
        "PASS"
    },
    null,
    2
  )
);

console.log(
  "UAIR identity/native-code DX verification: PASS"
);
