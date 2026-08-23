import type {
  Execution
} from "@uair/core";

/**
 * Lossy status projection reserved for a future negotiated MCP Tasks seam.
 * SDK 2.0.0 exposes only legacy Tasks wire types, so servers remain on the
 * opaque Execution-handle fallback until a current runtime API is available.
 */
export function executionTaskStatus(
  status: Execution["status"]
) {
  switch (status) {
    case "running":
      return "working" as const;
    case "suspended":
      return "input_required" as const;
    case "completed":
      return "completed" as const;
    case "failed":
      return "failed" as const;
    case "cancelled":
      return "cancelled" as const;
  }
}
