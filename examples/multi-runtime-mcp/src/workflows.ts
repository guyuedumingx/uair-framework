import {
  workflow
} from "@uair/core";

export const createReminder = workflow(
  "personal.reminder.create",
  async (
    input: {
      at: string;
      message: string;
    }
  ) => ({
    reminderId: `reminder:${input.at}`,
    at: input.at,
    message: input.message
  })
);

export const requestLeave = workflow(
  "hr.leave.request",
  async (
    input: {
      employeeId: string;
      date: string;
    }
  ) => ({
    requestId: `leave:${input.employeeId}:${input.date}`,
    status: "submitted"
  })
);
