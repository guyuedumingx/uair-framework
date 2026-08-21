import assert from "node:assert/strict";

import {
  CapabilityResolver
} from "../packages/package/dist/index.js";

import {
  resolveOrForgeCapability
} from "../packages/forge/dist/index.js";

const order = [];

const resolver =
  new CapabilityResolver(
    [],
    {
      async search() {
        order.push(
          "catalog"
        );

        return [];
      }
    }
  );

const result =
  await resolveOrForgeCapability(
    {
      query:
        "convert foreign exchange",
      requiredKind:
        "tool"
    },
    {
      resolver,

      synthesize: {
        async synthesize() {
          order.push(
            "synthesize"
          );

          return {
            packageName:
              "@demo/fx",
            capabilityId:
              "finance.fx.convert",
            files: [
              {
                path:
                  "src/index.ts",
                content:
                  "export const ok = true"
              }
            ]
          };
        }
      },

      inspect: {
        async inspect() {
          order.push(
            "inspect"
          );

          return {
            allowed: true,
            reasons: []
          };
        }
      },

      sandbox: {
        async buildAndTest() {
          order.push(
            "sandbox"
          );

          return {
            ok: true,
            installDir:
              "/sandbox/demo-fx"
          };
        }
      },

      approval: {
        async approve() {
          order.push(
            "approve"
          );

          return {
            approved:
              true
          };
        }
      },

      activate: {
        async activate() {
          order.push(
            "activate"
          );

          return {
            manifest: {
              capabilities: [
                {
                  id:
                    "finance.fx.convert",
                  kind:
                    "tool",
                  description:
                    "Convert currencies"
                }
              ]
            }
          };
        }
      }
    }
  );

assert.equal(
  result.kind,
  "generated"
);

assert.deepEqual(
  order,
  [
    "catalog",
    "synthesize",
    "inspect",
    "sandbox",
    "approve",
    "activate"
  ]
);

assert.equal(
  resolver
    .loadedCapabilities()
    .has(
      "finance.fx.convert"
    ),
  true
);

console.log(
  "UAIR capability Forge pipeline verification: PASS"
);


const installOrder = [];

const installResolver =
  new CapabilityResolver(
    [],
    {
      async search() {
        installOrder.push(
          "catalog"
        );

        return [
          {
            packageName:
              "@demo/fx-ready",
            version:
              "1.2.3",
            capabilities: [
              {
                id:
                  "finance.fx.convert",
                description:
                  "convert foreign exchange",
                metadata: {
                  exportName:
                    "convertFx"
                }
              }
            ]
          }
        ];
      }
    }
  );

const installed =
  await resolveOrForgeCapability(
    {
      query:
        "convert foreign exchange",
      requiredKind:
        "tool"
    },
    {
      resolver:
        installResolver,
      acquire: {
        async acquire(
          candidate
        ) {
          installOrder.push(
            "acquire"
          );

          assert.equal(
            candidate.sourceName,
            "@demo/fx-ready"
          );

          return {
            packageName:
              candidate.sourceName
          };
        }
      },
      synthesize: {
        async synthesize() {
          installOrder.push(
            "SHOULD_NOT_SYNTHESIZE"
          );
          throw new Error(
            "installable capability must win before generation"
          );
        }
      },
      inspect: {
        async inspect() {
          throw new Error(
            "not reached"
          );
        }
      },
      sandbox: {
        async buildAndTest() {
          throw new Error(
            "not reached"
          );
        }
      },
      approval: {
        async approve() {
          throw new Error(
            "not reached"
          );
        }
      },
      activate: {
        async activate() {
          throw new Error(
            "not reached"
          );
        }
      }
    }
  );

assert.equal(
  installed.kind,
  "installed"
);

assert.deepEqual(
  installOrder,
  [
    "catalog",
    "acquire"
  ]
);

console.log(
  "UAIR capability Forge install-before-generate verification: PASS"
);
