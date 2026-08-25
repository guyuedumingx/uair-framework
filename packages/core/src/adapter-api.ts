/**
 * Runtime adapter implementation SPI.
 *
 * Application code should not import this entry point. Storage and locking
 * adapters may use it without depending on the unsupported `/internal` path.
 */
export {
  currentFence,
  StaleFenceError,
  runWithFence
} from "./fence.js";

export type {
  LockManager
} from "./lock.js";
