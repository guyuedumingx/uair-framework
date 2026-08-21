import {
  workflow
} from "@uair/core";
import {
  ui
} from "@uair/ui";

const askName =
  ui<
    { prompt: string },
    { name: string }
  >("AskName");

export const hello =
  workflow(
    "hello",
    async () => {
      const answer =
        await askName({
          prompt:
            "What is your name?"
        });

      return {
        message:
          `Hello ${answer.name}`
      };
    }
  );

console.log(
  "UAIR basic example loaded:",
  hello.id
);
