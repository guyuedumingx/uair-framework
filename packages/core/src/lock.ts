export interface LockManager {
  withLock<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T>;
}

/**
 * In-process lock for the PoC.
 *
 * Production implementations must use a distributed lease/lock
 * provided by the selected durable backend or database.
 */
export class InMemoryLockManager
  implements LockManager {
  private tails =
    new Map<string, Promise<void>>();

  async withLock<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const previous =
      this.tails.get(key) ??
      Promise.resolve();

    let release!: () => void;

    const gate =
      new Promise<void>(
        resolve => {
          release = resolve;
        }
      );

    const tail =
      previous.then(
        () => gate
      );

    this.tails.set(
      key,
      tail
    );

    await previous;

    try {
      return await fn();
    } finally {
      release();

      if (
        this.tails.get(key) ===
        tail
      ) {
        this.tails.delete(key);
      }
    }
  }
}
