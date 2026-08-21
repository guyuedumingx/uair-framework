import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { component, run, workflow } from "../packages/core/dist/index.js";
import {
  cancelSuspension,
  resolveSuspension
} from "../packages/core/dist/runtime-api.js";
import { SqliteRuntimeState } from "../packages/sqlite/dist/index.js";

const dir = await mkdtemp(join(tmpdir(), "uair-suspension-race-"));
const state = new SqliteRuntimeState(join(dir, "state.sqlite"));

function barrier(count) {
  let waiting = 0;
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return async () => {
    waiting += 1;
    if (waiting === count) release();
    await promise;
  };
}

try {
  const waitExternal = component("race.wait.external", async (_input, ctx) => {
    return ctx.suspend({ type: "race-test" });
  });

  const wait = workflow("race.wait", { version: "1" }, async () => {
    return waitExternal({});
  });

  const started = await run(wait, {}, state);
  assert.equal(started.status, "suspended");

  const indexed = await state.listSuspensions();
  assert.equal(indexed.length, 1);
  const suspensionId = indexed[0].suspension.suspensionId;

  // Force both contenders to observe the same suspension index and same
  // Execution revision before either is allowed to commit.
  const afterFind = barrier(2);
  const afterLoad = barrier(2);

  function contenderStorage() {
    return new Proxy(state, {
      get(target, prop) {
        if (prop === "findSuspension") {
          return async id => {
            const result = await target.findSuspension(id);
            await afterFind();
            return result;
          };
        }
        if (prop === "loadExecution") {
          return async id => {
            const result = await target.loadExecution(id);
            await afterLoad();
            return result;
          };
        }
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }

  const [resolvedResult, cancelledResult] = await Promise.all([
    resolveSuspension(
      suspensionId,
      { approved: true },
      contenderStorage(),
      "manual",
      "user:one"
    ),
    cancelSuspension(
      suspensionId,
      contenderStorage(),
      "timeout"
    )
  ]);

  const final = await state.loadExecution(started.id);
  const terminal = final.history.filter(entry =>
    (entry.kind === "suspension_resolved" || entry.kind === "suspension_cancelled") &&
    entry.suspensionId === suspensionId
  );

  assert.equal(
    terminal.length,
    1,
    "resolve vs cancel race must have exactly one durable terminal winner"
  );

  const winner = terminal[0].kind;
  assert.equal(
    ["suspension_resolved", "suspension_cancelled"].includes(winner),
    true
  );

  for (const result of [resolvedResult, cancelledResult]) {
    const seen = result.history.filter(entry =>
      (entry.kind === "suspension_resolved" || entry.kind === "suspension_cancelled") &&
      entry.suspensionId === suspensionId
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, winner);
  }

  assert.equal(await state.findSuspension(suspensionId), null);

  // Event vs timer can also arrive at nearly the same instant. They are both
  // resolution attempts, so exactly one value/reason must become durable.
  const second = await run(wait, {}, state);
  assert.equal(second.status, "suspended");

  const secondIndex = (await state.listSuspensions()).find(
    item => item.executionId === second.id
  );
  assert.ok(secondIndex);
  const secondSuspensionId = secondIndex.suspension.suspensionId;

  const eventFind = barrier(2);
  const eventLoad = barrier(2);

  function eventContenderStorage() {
    return new Proxy(state, {
      get(target, prop) {
        if (prop === "findSuspension") {
          return async id => {
            const result = await target.findSuspension(id);
            await eventFind();
            return result;
          };
        }
        if (prop === "loadExecution") {
          return async id => {
            const result = await target.loadExecution(id);
            await eventLoad();
            return result;
          };
        }
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }

  const [eventResult, timerResult] = await Promise.all([
    resolveSuspension(
      secondSuspensionId,
      { source: "event" },
      eventContenderStorage(),
      "event"
    ),
    resolveSuspension(
      secondSuspensionId,
      { source: "timer" },
      eventContenderStorage(),
      "timer"
    )
  ]);

  const secondFinal = await state.loadExecution(second.id);
  const resolutions = secondFinal.history.filter(entry =>
    entry.kind === "suspension_resolved" &&
    entry.suspensionId === secondSuspensionId
  );
  const resumeRequests = secondFinal.history.filter(entry =>
    entry.kind === "resume_requested" &&
    entry.suspensionId === secondSuspensionId
  );

  assert.equal(resolutions.length, 1, "event/timer race must have one resolution");
  assert.equal(resumeRequests.length, 1, "event/timer race must enqueue one resume intent");
  for (const result of [eventResult, timerResult]) {
    const seen = result.history.filter(entry =>
      entry.kind === "suspension_resolved" &&
      entry.suspensionId === secondSuspensionId
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].value.source, resolutions[0].value.source);
  }
  assert.equal(await state.findSuspension(secondSuspensionId), null);

  console.log(JSON.stringify({
    winner,
    terminalEvents: terminal.length,
    suspensionIndexRemoved: true,
    eventTimerWinner: resolutions[0].value.source,
    eventTimerResolutionCount: resolutions.length,
    eventTimerResumeRequestCount: resumeRequests.length
  }, null, 2));
  console.log("UAIR resolve/cancel concurrency race verification: PASS");
} finally {
  state.close();
  await rm(dir, { recursive: true, force: true });
}
