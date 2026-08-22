import {
  createInterface
} from "node:readline";

import {
  spawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";

import type {
  ExternalAgentRunInput,
  ExternalAgentRuntime
} from "./external-agent.js";

export type CodexAppServerClientInfo = {
  name: string;
  title?: string;
  version: string;
};

export type CodexAppServerMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  [key: string]: unknown;
};

export type CodexAppServerRequest = {
  id: number | string;
  method: string;
  params?: unknown;
};

export type CodexAppServerTransport = {
  send(message: CodexAppServerMessage): Promise<void>;
  subscribe(
    handler: (
      message: CodexAppServerMessage
    ) => void
  ): () => void;
  close(): Promise<void>;
};

export type CodexAppServerTurnOutput = {
  threadId: string;
  sessionId?: string;
  turnId?: string;
  text: string;
  events: CodexAppServerMessage[];
};

export type CodexAppServerSessionRef = {
  provider: "codex-app-server";
  threadId: string;
  sessionId?: string;
};

export type CodexAppServerRuntimeOptions = {
  /** Codex executable, defaulting to CODEX_BIN or `codex`. */
  binary?: string;
  /** Working directory supplied to Codex thread/start. */
  cwd?: string;
  /** Extra environment values for the app-server child process. */
  env?: Record<string, string | undefined>;
  /** Override the default `codex app-server` argument list. */
  appServerArgs?: string[];
  model?: string;
  approvalPolicy?: unknown;
  sandbox?: unknown;
  timeoutMs?: number;
  clientInfo?: CodexAppServerClientInfo;
  experimentalApi?: boolean;
  /**
   * Handle server-initiated requests such as command/file approvals and
   * tool input. The returned value is sent as the JSON-RPC result.
   */
  onServerRequest?: (
    request: CodexAppServerRequest
  ) => Promise<unknown> | unknown;
  /** Observe streamed app-server notifications without taking ownership. */
  onEvent?: (
    event: CodexAppServerMessage
  ) => void;
  /**
   * Supply a custom transport for remote/embedded hosts. The default starts
   * a local `codex app-server` child process over JSONL stdio.
   */
  createTransport?: () =>
    | CodexAppServerTransport
    | Promise<CodexAppServerTransport>;
};

class CodexAppServerError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}

export class CodexAppServerRequestError
  extends CodexAppServerError {
  constructor(
    readonly request: CodexAppServerRequest
  ) {
    super(
      `Codex app-server request requires a handler: ${request.method}`
    );
    this.name = "CodexAppServerRequestError";
  }
}

function asRecord(
  value: unknown
): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function textInput(
  value: unknown
): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { text?: unknown }).text === "string"
  ) {
    return (value as { text: string }).text;
  }

  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function errorPayload(
  error: unknown
) {
  return {
    code: -32000,
    message: error instanceof Error ? error.message : String(error)
  };
}

class StdioCodexAppServerTransport
  implements CodexAppServerTransport {
  private readonly listeners = new Set<
    (message: CodexAppServerMessage) => void
  >();

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines;
  private closed = false;

  constructor(
    binary: string,
    args: string[],
    cwd: string | undefined,
    env: Record<string, string | undefined>
  ) {
    this.child = spawn(
      binary,
      args,
      {
        cwd,
        env: {
          ...process.env,
          ...env
        },
        stdio: [
          "pipe",
          "pipe",
          "pipe"
        ]
      }
    );

    this.lines = createInterface({
      input: this.child.stdout
    });

    this.lines.on(
      "line",
      line => {
        if (!line.trim()) {
          return;
        }

        try {
          const message = JSON.parse(line) as CodexAppServerMessage;
          this.emit(message);
        } catch (error) {
          this.emit({
            method: "uair/transportError",
            params: {
              message: error instanceof Error
                ? error.message
                : String(error),
              line
            }
          });
        }
      }
    );

    this.child.stderr.resume();

    this.child.on("error", error => {
      this.emit({
        method: "uair/transportError",
        params: {
          message: error.message
        }
      });
    });

    this.child.on("close", code => {
      if (!this.closed && code !== 0) {
        this.emit({
          method: "uair/transportError",
          params: {
            message: `Codex app-server exited with code ${code}.`
          }
        });
      }
    });
  }

  private emit(
    message: CodexAppServerMessage
  ) {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  async send(
    message: CodexAppServerMessage
  ) {
    if (this.closed || this.child.stdin.destroyed) {
      throw new Error("Codex app-server transport is closed.");
    }

    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(
        `${JSON.stringify(message)}\n`,
        error => error ? reject(error) : resolve()
      );
    });
  }

  subscribe(
    handler: (
      message: CodexAppServerMessage
    ) => void
  ) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.lines.close();
    this.child.kill();
  }
}

class CodexAppServerConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    }
  >();
  private readonly notifications: CodexAppServerMessage[] = [];
  private readonly waiters: Array<{
    resolve: (value: CodexAppServerMessage) => void;
    reject: (error: unknown) => void;
  }> = [];
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly transport: CodexAppServerTransport,
    private readonly onServerRequest:
      | CodexAppServerRuntimeOptions["onServerRequest"],
    private readonly onEvent:
      | CodexAppServerRuntimeOptions["onEvent"]
  ) {
    this.unsubscribe = transport.subscribe(
      message => this.handle(message)
    );
  }

  private handle(
    message: CodexAppServerMessage
  ) {
    if (message.method === "uair/transportError") {
      const params = asRecord(message.params);
      const error = new CodexAppServerError(
        typeof params.message === "string"
          ? params.message
          : "Codex app-server transport failed."
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(error);
      }
      return;
    }

    if (
      typeof message.method === "string"
    ) {
      this.onEvent?.(message);

      if (
        message.id !== undefined
      ) {
        void this.handleServerRequest({
          id: message.id,
          method: message.method,
          params: message.params
        });
        return;
      }

      const waiter = this.waiters.shift();
      if (waiter) {
        waiter.resolve(message);
      } else {
        this.notifications.push(message);
      }
      return;
    }

    if (
      typeof message.id === "number"
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(
          new CodexAppServerError(
            message.error.message ?? "Codex app-server request failed.",
            message.error.code,
            message.error.data
          )
        );
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private async handleServerRequest(
    request: CodexAppServerRequest
  ) {
    if (!this.onServerRequest) {
      await this.transport.send({
        id: request.id,
        error: errorPayload(
          new CodexAppServerRequestError(request)
        )
      });
      return;
    }

    try {
      const result = await this.onServerRequest(request);
      await this.transport.send({
        id: request.id,
        result: result ?? null
      });
    } catch (error) {
      await this.transport.send({
        id: request.id,
        error: errorPayload(error)
      });
    }
  }

  async request(
    method: string,
    params: unknown,
    signal?: AbortSignal
  ) {
    if (this.closed) {
      throw new Error("Codex app-server connection is closed.");
    }

    const id = this.nextId++;

    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    const abort = () => {
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      this.pending.delete(id);
      pending.reject(new Error("Codex app-server request was aborted."));
    };

    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }

    try {
      await this.transport.send({
        id,
        method,
        params
      });
      return await result;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async nextNotification(
    signal?: AbortSignal
  ) {
    const queued = this.notifications.shift();
    if (queued) {
      return queued;
    }

    return await new Promise<CodexAppServerMessage>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);

      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error("Codex app-server notification wait was aborted."));
      };

      if (signal?.aborted) {
        abort();
      } else {
        signal?.addEventListener("abort", abort, { once: true });
      }
    });
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.unsubscribe();
    const error = new Error("Codex app-server connection closed.");
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
    await this.transport.close();
  }
}

function definedEntries(
  value: Record<string, unknown>
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

export class CodexAppServerRuntime
  implements ExternalAgentRuntime<unknown, CodexAppServerTurnOutput> {
  constructor(
    private readonly options: CodexAppServerRuntimeOptions = {}
  ) {}

  private async createTransport() {
    if (this.options.createTransport) {
      return await this.options.createTransport();
    }

    return new StdioCodexAppServerTransport(
      this.options.binary ?? process.env.CODEX_BIN ?? "codex",
      this.options.appServerArgs ?? ["app-server"],
      this.options.cwd,
      this.options.env ?? {}
    );
  }

  async run(
    input: ExternalAgentRunInput<unknown> & {
      signal?: AbortSignal;
    }
  ): Promise<{
    type: "completed";
    output: CodexAppServerTurnOutput;
    sessionRef: CodexAppServerSessionRef;
  }> {
    const timeoutMs = this.options.timeoutMs ?? 10 * 60 * 1000;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeout.signal])
      : timeout.signal;
    const transport = await this.createTransport();
    const connection = new CodexAppServerConnection(
      transport,
      this.options.onServerRequest,
      this.options.onEvent
    );

    try {
      const clientInfo = this.options.clientInfo ?? {
        name: "uair-codex-app-server",
        title: "UAIR Codex App Server Adapter",
        version: "0.67.0"
      };

      await connection.request(
        "initialize",
        definedEntries({
          clientInfo,
          capabilities: this.options.experimentalApi
            ? { experimentalApi: true }
            : undefined
        }),
        signal
      );
      await transport.send({
        method: "initialized",
        params: {}
      });

      const existing = input.sessionRef as
        | Partial<CodexAppServerSessionRef>
        | undefined;

      let thread: Record<string, unknown>;
      if (existing) {
        if (
          existing.provider !== "codex-app-server" ||
          typeof existing.threadId !== "string"
        ) {
          throw new Error("Invalid Codex app-server sessionRef.");
        }

        thread = asRecord(
          await connection.request(
            "thread/resume",
            definedEntries({
              threadId: existing.threadId,
              model: this.options.model,
              cwd: this.options.cwd
            }),
            signal
          )
        ).thread as Record<string, unknown>;
      } else {
        thread = asRecord(
          await connection.request(
            "thread/start",
            definedEntries({
              model: this.options.model,
              cwd: this.options.cwd,
              approvalPolicy: this.options.approvalPolicy,
              sandbox: this.options.sandbox
            }),
            signal
          )
        ).thread as Record<string, unknown>;
      }

      const threadId = String(thread.id ?? "");
      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id.");
      }

      const turnResult = asRecord(
        await connection.request(
          "turn/start",
          {
            threadId,
            input: [
              {
                type: "text",
                text: input.resume === undefined
                  ? textInput(input.input)
                  : `${textInput(input.input)}\n\nExternal response:\n${textInput(input.resume)}`
              }
            ],
            model: this.options.model
          },
          signal
        )
      );

      const turn = asRecord(turnResult.turn);
      const turnId = typeof turn.id === "string"
        ? turn.id
        : undefined;
      const events: CodexAppServerMessage[] = [];
      const deltas: string[] = [];
      let completed: CodexAppServerMessage | undefined;

      while (!completed) {
        const event = await connection.nextNotification(signal);
        events.push(event);

        if (
          event.method === "item/agentMessage/delta"
        ) {
          const params = asRecord(event.params);
          if (typeof params.delta === "string") {
            deltas.push(params.delta);
          }
        }

        if (
          event.method === "turn/completed" ||
          event.method === "turn/failed" ||
          event.method === "turn/interrupted"
        ) {
          completed = event;
        }
      }

      const completedParams = asRecord(completed.params);
      const completedTurn = asRecord(completedParams.turn);
      const finalText = deltas.join("") ||
        (typeof completedTurn.output === "string"
          ? completedTurn.output
          : "");

      const sessionId = typeof thread.sessionId === "string"
        ? thread.sessionId
        : undefined;

      return {
        type: "completed",
        sessionRef: {
          provider: "codex-app-server",
          threadId,
          sessionId
        },
        output: {
          threadId,
          sessionId,
          turnId,
          text: finalText,
          events
        }
      };
    } finally {
      clearTimeout(timer);
      await connection.close();
    }
  }
}
