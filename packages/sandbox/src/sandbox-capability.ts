import {
  component
} from "@uair/core";
import {
  capability
} from "@uair/package";
import type {
  Capability
} from "@uair/package";
import type {
  SandboxRunner
} from "./sandbox-installer.js";
import type {
  PackageTrustRecord
} from "@uair/security";

export type SandboxedCapabilityDescriptor = {
  id: string;
  description?: string;
  tags?: string[];
  inputSchema?: unknown;
  entrypoint: string;
  metadata?: Record<
    string,
    unknown
  >;
};

export function sandboxedCapability(
  input: {
    packageName: string;
    installDir: string;
    descriptor:
      SandboxedCapabilityDescriptor;
    trust:
      PackageTrustRecord;
    runner:
      SandboxRunner;
  }
): Capability {
  const run =
    component<
      Record<
        string,
        unknown
      > | undefined,
      unknown
    >(
      `pkg:${input.packageName}:${input.descriptor.id}`,
      async args => {
        const result =
          await input.runner.run({
            cwd:
              input.installDir,
            command:
              process.execPath,
            args: [
              input.descriptor.entrypoint,
              JSON.stringify(
                args ?? {}
              )
            ],
            env: {
              PATH:
                process.env.PATH ??
                "",
              HOME:
                input.installDir
            },
            network:
              input.trust.network ??
              "none",
            filesystem:
              input.trust.filesystem ??
              "isolated"
          });

        if (
          result.exitCode !== 0
        ) {
          throw new Error(
            `sandboxed capability failed: ${result.stderr || result.stdout}`
          );
        }

        const text =
          result.stdout.trim();

        return text
          ? JSON.parse(text)
          : undefined;
      }
    );

  return capability({
    id:
      input.descriptor.id,
    kind: "tool",
    description:
      input.descriptor
        .description,
    tags:
      input.descriptor.tags,
    inputSchema:
      input.descriptor
        .inputSchema,
    invoke:
      run as any,
    metadata: {
      ...input.descriptor
        .metadata,
      packageName:
        input.packageName,
      sandboxed: true
    }
  });
}
