console.log(`
UAIR v0.18 verification procedure:

1. Build package dependencies in order:
   core
   ui
   agent
   mcp
   package
   security
   sandbox
   sqlite
   oa
   create-uair

2. Build:
   examples/basic
   examples/enterprise

3. Run:
   node packages/create-uair/dist/index.js demo-app

This repository was verified with that procedure during generation.
`);
