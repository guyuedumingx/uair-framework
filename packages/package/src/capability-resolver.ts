import type {
  Capability
} from "./capability.js";
import {
  CapabilitySet
} from "./capability.js";
import type {
  LoadedUairPackage
} from "./package-contract.js";
import type {
  McpServerAdapter
} from "@uair/mcp";
import {
  capability
} from "./capability.js";

export type CapabilitySourceKind =
  | "loaded-package"
  | "connected-mcp"
  | "installable-package";

export type CapabilityCandidate = {
  id: string;
  description?: string;
  sourceKind:
    CapabilitySourceKind;
  sourceName: string;
  score: number;
  executable: boolean;
  metadata?: Record<
    string,
    unknown
  >;
};

export type InstallablePackageRecord = {
  packageName: string;
  version?: string;
  description?: string;
  capabilities: Array<{
    id: string;
    description?: string;
    tags?: string[];
    metadata?: Record<
      string,
      unknown
    >;
  }>;
};

export interface PackageCatalog {
  search(
    query: string
  ): Promise<
    InstallablePackageRecord[]
  >;
}

function tokens(
  value: string
) {
  return value
    .toLowerCase()
    .split(
      /[^a-z0-9_.-]+/
    )
    .filter(Boolean);
}

function score(
  query: string,
  id: string,
  description = "",
  tags: string[] = []
) {
  const q =
    tokens(query);

  const haystack =
    `${id} ${description} ${tags.join(" ")}`
      .toLowerCase();

  let total = 0;

  for (const token of q) {
    if (
      id
        .toLowerCase()
        .includes(token)
    ) {
      total += 4;
    }

    if (
      haystack.includes(token)
    ) {
      total += 2;
    }
  }

  return total;
}

export class CapabilityResolver {
  private readonly loaded =
    new CapabilitySet();

  private readonly mcpServers =
    new Map<
      string,
      McpServerAdapter
    >();

  constructor(
    packages:
      LoadedUairPackage[] = [],
    private readonly catalog?:
      PackageCatalog
  ) {
    for (const pkg of packages) {
      for (
        const cap
        of pkg.manifest
          .capabilities ?? []
      ) {
        this.loaded.add(
          cap
        );
      }
    }
  }

  addPackage(
    pkg: LoadedUairPackage
  ) {
    for (
      const cap
      of pkg.manifest
        .capabilities ?? []
    ) {
      this.loaded.add(
        cap
      );
    }
  }

  addMcp(
    name: string,
    server:
      McpServerAdapter
  ) {
    this.mcpServers.set(
      name,
      server
    );
  }

  loadedCapabilities() {
    return new CapabilitySet(
      this.loaded.list()
    );
  }

  async discover(
    query: string
  ): Promise<
    CapabilityCandidate[]
  > {
    const candidates:
      CapabilityCandidate[] = [];

    for (
      const cap
      of this.loaded.list()
    ) {
      const s =
        score(
          query,
          cap.id,
          cap.description,
          cap.tags
        );

      if (s > 0) {
        candidates.push({
          id: cap.id,
          description:
            cap.description,
          sourceKind:
            "loaded-package",
          sourceName:
            "loaded",
          score: s,
          executable: true,
          metadata:
            cap.metadata
        });
      }
    }

    for (
      const [
        serverName,
        server
      ]
      of this.mcpServers
    ) {
      const tools =
        await server.listTools();

      for (const tool of tools) {
        const id =
          `mcp:${serverName}:${tool.name}`;

        const s =
          score(
            query,
            id,
            tool.description
          );

        if (s > 0) {
          candidates.push({
            id,
            description:
              tool.description,
            sourceKind:
              "connected-mcp",
            sourceName:
              serverName,
            score: s,
            executable: true
          });
        }
      }
    }

    if (this.catalog) {
      const packages =
        await this.catalog.search(
          query
        );

      for (const pkg of packages) {
        for (
          const cap
          of pkg.capabilities
        ) {
          const s =
            score(
              query,
              cap.id,
              cap.description,
              cap.tags
            );

          if (s > 0) {
            candidates.push({
              id: cap.id,
              description:
                cap.description,
              sourceKind:
                "installable-package",
              sourceName:
                pkg.packageName,
              score: s,
              executable: false,
              metadata: {
                ...cap.metadata,
                packageVersion:
                  pkg.version
              }
            });
          }
        }
      }
    }

    return candidates.sort(
      (a, b) =>
        b.score - a.score
    );
  }

  async materializeConnectedMcpCapabilities() {
    const result =
      new CapabilitySet();

    for (
      const [
        serverName,
        server
      ]
      of this.mcpServers
    ) {
      const tools =
        await server.listTools();

      for (const tool of tools) {
        result.add(
          capability({
            id:
              `mcp:${serverName}:${tool.name}`,
            kind: "tool",
            description:
              tool.description,
            inputSchema:
              tool.inputSchema,
            invoke:
              server.tool(
                tool.name
              ) as any,
            metadata: {
              source:
                "mcp",
              server:
                serverName
            }
          })
        );
      }
    }

    return result;
  }
}
