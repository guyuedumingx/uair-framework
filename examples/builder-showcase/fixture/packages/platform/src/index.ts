import {
  component
} from "@uair/core";

export const employeeLookup =
  component({
    id:
      "employee.lookup",

    async run(input: unknown) {
      return input;
    }
  });

export const auditAppend =
  component({
    id:
      "audit.append",

    async run(input: unknown) {
      return {
        immutable: true,
        input
      };
    }
  });
