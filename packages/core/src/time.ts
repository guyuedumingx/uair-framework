import { component } from "./core.js";

export const sleep = component<
  number,
  void
>(
  "uair.sleep",
  async (ms, ctx) => {
    return ctx.suspend<void>({
      type: "timer",
      deadline: Date.now() + ms
    });
  }
);
