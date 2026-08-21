import {
  component
} from "@uair/core";
import type {
  Component,
  ComponentOptions
} from "@uair/core";

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type McpCallResult = {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

export interface McpClientLike {
  listTools():
    Promise<{
      tools:
        McpToolDefinition[];
    }>;

  callTool(
    request: {
      name: string;
      arguments?: Record<
        string,
        unknown
      >;
    },
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<McpCallResult>;

  close?():
    Promise<void>;
}

export type McpAdapterOptions = {
  tool?: ComponentOptions;
  discoveryTtlMs?: number;
};


export interface McpHttpConnectionPolicy {
  assertAllowed(
    url: URL
  ): Promise<void> | void;
}

export interface McpStdioProcessPolicy {
  assertAllowed(
    input: {
      command: string;
      args: string[];
      cwd?: string;
      envKeys: string[];
    }
  ): Promise<void> | void;
}

export class McpConnectionDeniedError
  extends Error {
  constructor(
    message: string
  ) {
    super(message);
    this.name =
      "McpConnectionDeniedError";
  }
}

function isPrivateIpv4(
  value: string
) {
  const parts =
    value.split(".")
      .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      item =>
        !Number.isInteger(
          item
        ) ||
        item < 0 ||
        item > 255
    )
  ) {
    return false;
  }

  const [a, b] =
    parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (
      a === 100 &&
      b >= 64 &&
      b <= 127
    ) ||
    (
      a === 169 &&
      b === 254
    ) ||
    (
      a === 172 &&
      b >= 16 &&
      b <= 31
    ) ||
    (
      a === 192 &&
      b === 168
    )
  );
}

function isPrivateIpv6(
  value: string
) {
  const normalized =
    value.toLowerCase();

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^(fe8|fe9|fea|feb)/.test(
      normalized
    )
  );
}

export type DefaultMcpHttpPolicyOptions = {
  allowHttp?: boolean;
  allowedHosts?: string[];
  resolver?:
    (
      hostname: string
    ) => Promise<string[]>;
};

export function defaultMcpHttpConnectionPolicy(
  options:
    DefaultMcpHttpPolicyOptions =
      {}
): McpHttpConnectionPolicy {
  return {
    async assertAllowed(
      url
    ) {
      if (
        url.username ||
        url.password
      ) {
        throw new McpConnectionDeniedError(
          "MCP URL credentials are not allowed."
        );
      }

      if (
        url.protocol !==
          "https:" &&
        !(
          options.allowHttp &&
          url.protocol ===
            "http:"
        )
      ) {
        throw new McpConnectionDeniedError(
          `MCP protocol "${url.protocol}" is not allowed.`
        );
      }

      if (
        options.allowedHosts &&
        !options.allowedHosts.includes(
          url.hostname
        )
      ) {
        throw new McpConnectionDeniedError(
          `MCP host "${url.hostname}" is not on the allowlist.`
        );
      }

      const resolver =
        options.resolver ??
        (
          async (
            hostname:
              string
          ) => {
            const dns =
              await import(
                "node:dns/promises"
              );

            const result =
              await dns.lookup(
                hostname,
                {
                  all: true,
                  verbatim: true
                }
              );

            return result.map(
              item =>
                item.address
            );
          }
        );

      const addresses =
        await resolver(
          url.hostname
        );

      if (
        addresses.length === 0
      ) {
        throw new McpConnectionDeniedError(
          `MCP host "${url.hostname}" has no resolved address.`
        );
      }

      for (
        const address
        of addresses
      ) {
        if (
          isPrivateIpv4(
            address
          ) ||
          isPrivateIpv6(
            address
          )
        ) {
          throw new McpConnectionDeniedError(
            `MCP host "${url.hostname}" resolves to blocked address "${address}".`
          );
        }
      }
    }
  };
}

export function allowListedMcpStdioPolicy(
  commands: string[]
): McpStdioProcessPolicy {
  const allowed =
    new Set(
      commands
    );

  return {
    assertAllowed(
      input
    ) {
      if (
        !allowed.has(
          input.command
        )
      ) {
        throw new McpConnectionDeniedError(
          `MCP stdio command "${input.command}" is not on the allowlist.`
        );
      }
    }
  };
}


export class McpToolError
  extends Error {
  constructor(
    readonly serverName: string,
    readonly toolName: string,
    readonly result:
      McpCallResult
  ) {
    super(
      `MCP tool "${serverName}/${toolName}" returned isError=true`
    );

    this.name =
      "McpToolError";
  }
}

export class McpServerAdapter {
  private readonly tools =
    new Map<
      string,
      Component<
        Record<
          string,
          unknown
        > | undefined,
        McpCallResult
      >
    >();

  private readonly discoverComponent:
    Component<
      void,
      McpToolDefinition[]
    >;

  constructor(
    readonly name: string,
    private readonly client:
      McpClientLike,
    private readonly options:
      McpAdapterOptions = {}
  ) {
    this.discoverComponent =
      component<
        void,
        McpToolDefinition[]
      >(
        `mcp:${name}:listTools`,
        {
          resultValidForMs:
            options
              .discoveryTtlMs ??
            30_000
        },
        async () => {
          const result =
            await this.client
              .listTools();

          return result.tools;
        }
      );
  }

  listTools() {
    return this
      .discoverComponent(
        undefined
      );
  }

  tool(
    toolName: string
  ) {
    let existing =
      this.tools.get(
        toolName
      );

    if (existing) {
      return existing;
    }

    const created =
      component<
        Record<
          string,
          unknown
        > | undefined,
        McpCallResult
      >(
        `mcp:${this.name}:${toolName}`,
        this.options.tool ?? {},
        async (args, ctx) => {
          ctx.setAttribute(
            "rpc.system",
            "mcp"
          );

          ctx.setAttribute(
            "mcp.server",
            this.name
          );

          ctx.setAttribute(
            "mcp.tool",
            toolName
          );

          const startedAt =
            Date.now();

          const result =
            await this.client
              .callTool(
                {
                  name: toolName,
                  arguments: args
                },
                {
                  signal:
                    ctx.signal
                }
              );

          ctx.addMetric(
            "mcp.latency_ms",
            Date.now() -
              startedAt
          );

          // MCP specifies tool-declared failures as ordinary tool
          // results with isError=true. At the UAIR Component boundary
          // we surface that as an exception so normal retry/try-catch
          // semantics apply.
          if (
            result.isError === true
          ) {
            throw new McpToolError(
              this.name,
              toolName,
              result
            );
          }

          return result;
        }
      );

    this.tools.set(
      toolName,
      created
    );

    return created;
  }

  call(
    toolName: string,
    args?: Record<
      string,
      unknown
    >
  ) {
    return this
      .tool(toolName)(
        args
      );
  }

  close() {
    return this.client
      .close?.() ??
      Promise.resolve();
  }
}

export function mcp(
  name: string,
  client: McpClientLike,
  options:
    McpAdapterOptions = {}
) {
  return new McpServerAdapter(
    name,
    client,
    options
  );
}

/**
 * Real MCP v2 Streamable HTTP connection.
 */
export async function connectMcpHttp(
  name: string,
  url: string,
  options:
    McpAdapterOptions & {
      connectionPolicy?:
        McpHttpConnectionPolicy;
    } = {}
) {
  const target =
    new URL(
      url
    );

  await (
    options.connectionPolicy ??
    defaultMcpHttpConnectionPolicy()
  ).assertAllowed(
    target
  );

  const moduleName =
    "@modelcontextprotocol/client";

  const sdk: any =
    await import(moduleName);

  const client =
    new sdk.Client(
      {
        name:
          `uair:${name}`,
        version: "0.1.0"
      },
      {
        versionNegotiation: {
          mode: "auto"
        }
      }
    );

  const transport =
    new sdk
      .StreamableHTTPClientTransport(
        target
      );

  await client.connect(
    transport
  );

  return mcp(
    name,
    client,
    options
  );
}

/**
 * Real MCP v2 stdio connection.
 */
export async function connectMcpStdio(
  name: string,
  config: {
    command: string;
    args?: string[];
    env?:
      Record<
        string,
        string
      >;
    cwd?: string;
  },
  options:
    McpAdapterOptions & {
      processPolicy?:
        McpStdioProcessPolicy;
    } = {}
) {
  if (
    !options.processPolicy
  ) {
    throw new McpConnectionDeniedError(
      "MCP stdio requires an explicit processPolicy allowlist."
    );
  }

  await options.processPolicy
    .assertAllowed({
      command:
        config.command,
      args:
        config.args ?? [],
      cwd:
        config.cwd,
      envKeys:
        Object.keys(
          config.env ??
          {}
        )
    });

  const clientModule =
    "@modelcontextprotocol/client";

  const stdioModule =
    "@modelcontextprotocol/client/stdio";

  const sdk: any =
    await import(
      clientModule
    );

  const stdio: any =
    await import(
      stdioModule
    );

  const client =
    new sdk.Client(
      {
        name:
          `uair:${name}`,
        version: "0.1.0"
      },
      {
        versionNegotiation: {
          mode: "auto"
        }
      }
    );

  const transport =
    new stdio
      .StdioClientTransport({
        command:
          config.command,
        args:
          config.args ?? [],
        env:
          config.env,
        cwd:
          config.cwd
      });

  await client.connect(
    transport
  );

  return mcp(
    name,
    client,
    options
  );
}
