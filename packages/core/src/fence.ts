import {
  AsyncLocalStorage
} from "node:async_hooks";

export type FenceContext = {
  lockKey: string;
  owner: string;
  token: number;
};

const fenceStorage =
  new AsyncLocalStorage<FenceContext>();

export function runWithFence<T>(
  context: FenceContext,
  fn: () => Promise<T>
): Promise<T> {
  return fenceStorage.run(
    context,
    fn
  );
}

export function currentFence():
  FenceContext | undefined {
  return fenceStorage.getStore();
}

export class StaleFenceError
  extends Error {
  constructor(
    message: string
  ) {
    super(message);
    this.name =
      "StaleFenceError";
  }
}
