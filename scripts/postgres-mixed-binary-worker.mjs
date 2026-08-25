import { pathToFileURL } from "node:url";
import pg from "pg";

const [modulePath, label, delayText = "0"] = process.argv.slice(2);
const { PostgresRuntimeState } = await import(pathToFileURL(modulePath).href);
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const state = new PostgresRuntimeState(pool);

try {
  await state.migrate();
  const execution = await state.loadExecution("rolling-execution");
  if (!execution) throw new Error("rolling execution not found");
  const loadedRevision = execution.revision;
  const delay = Number(delayText);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  execution.input = {
    ...execution.input,
    writes: [...(execution.input?.writes ?? []), label]
  };
  await state.saveExecution(execution, loadedRevision);
  process.stdout.write(`${JSON.stringify({
    label,
    status: "saved",
    loadedRevision,
    savedRevision: execution.revision
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    label,
    status: "rejected",
    error: error?.name,
    message: error?.message
  })}\n`);
  process.exitCode = 3;
} finally {
  await pool.end();
}
