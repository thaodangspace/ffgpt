import WebSocket, { type RawData } from 'ws';
import {
  BrowserCommandTimeoutError,
  BrowserConnectionError,
  BrowserDriverError,
  BrowserProtocolError,
} from './errors.js';
import type { BrowserContextInfo, BrowserDriver } from './types.js';

export interface FirefoxBiDiDriverOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  webSocketConstructor?: WebSocketConstructor;
}

export type WebSocketConstructor = new (url: string) => WebSocket;

interface BiDiCommandResponse<T> {
  id: number;
  type: 'success' | 'error';
  result?: T;
  error?: string;
  message?: string;
  stacktrace?: string;
}

interface BiDiContextTreeNode {
  context: string;
  url: string;
  children?: BiDiContextTreeNode[];
}

interface BiDiRemoteValue {
  type: string;
  value?: unknown;
}

interface PendingCommand<T> {
  method: string;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

export const DEFAULT_BIDI_TIMEOUT_MS = 5_000;

export function buildBiDiEndpoint(host: string, port: number): string {
  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `ws://${formattedHost}:${port}/session`;
}

export class FirefoxBiDiDriver implements BrowserDriver {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly webSocketConstructor: WebSocketConstructor;
  private socket: WebSocket | undefined;
  private nextCommandId = 1;
  private connected = false;
  private readonly pending = new Map<number, PendingCommand<unknown>>();

  constructor(options: FirefoxBiDiDriverOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 9222;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_BIDI_TIMEOUT_MS;
    this.webSocketConstructor = options.webSocketConstructor ?? WebSocket;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const endpoint = buildBiDiEndpoint(this.host, this.port);
    let socket: WebSocket;
    try {
      socket = new this.webSocketConstructor(endpoint);
    } catch (error: unknown) {
      throw new BrowserConnectionError(this.connectionFailureMessage(error), { cause: error });
    }

    this.socket = socket;
    this.installSocketHandlers(socket);
    try {
      await this.waitForSocketOpen(socket);
      await this.command('session.new', { capabilities: { alwaysMatch: {} } });
      this.connected = true;
    } catch (error: unknown) {
      await this.closeSocket(socket);
      if (error instanceof BrowserDriverError) {
        throw error;
      }
      throw new BrowserConnectionError(this.connectionFailureMessage(error), { cause: error });
    }
  }

  async listContexts(): Promise<BrowserContextInfo[]> {
    this.ensureConnected();
    const response = await this.command<{ contexts: BiDiContextTreeNode[] }>(
      'browsingContext.getTree',
      { maxDepth: 0 },
    );
    const roots = response.contexts ?? [];
    return Promise.all(
      roots.map(async (context) => {
        let title: string | undefined;
        try {
          title = await this.evaluate<string>(context.context, '() => document.title');
        } catch {
          // A context can disappear while it is being inspected. Its URL is still useful.
        }
        return {
          id: context.context,
          url: context.url,
          ...(title === undefined ? {} : { title }),
        };
      }),
    );
  }

  async createContext(): Promise<string> {
    this.ensureConnected();
    const response = await this.command<{ context: string }>('browsingContext.create', {
      type: 'tab',
    });
    if (typeof response.context !== 'string' || response.context.length === 0) {
      throw new BrowserProtocolError(
        'Firefox returned an invalid browsing context id.',
        'browsingContext.create',
      );
    }
    return response.context;
  }

  async navigate(contextId: string, url: string): Promise<void> {
    this.ensureConnected();
    await this.command('browsingContext.navigate', {
      context: contextId,
      url,
      wait: 'complete',
    });
  }

  async evaluate<T>(
    contextId: string,
    functionDeclaration: string,
    args: readonly unknown[] = [],
  ): Promise<T> {
    this.ensureConnected();
    const response = await this.command<{ result?: BiDiRemoteValue; exceptionDetails?: unknown }>(
      'script.callFunction',
      {
        functionDeclaration,
        awaitPromise: true,
        target: { context: contextId },
        arguments: args.map(toRemoteValue),
      },
    );

    if (response.exceptionDetails !== undefined) {
      throw new BrowserProtocolError(
        `Page script failed: ${formatException(response.exceptionDetails)}`,
        'script.callFunction',
      );
    }
    if (response.result === undefined) {
      throw new BrowserProtocolError('Firefox returned no script result.', 'script.callFunction');
    }
    return fromRemoteValue(response.result) as T;
  }

  async pressKey(contextId: string, key: string): Promise<void> {
    this.ensureConnected();
    await this.command('input.performActions', {
      context: contextId,
      actions: [
        {
          type: 'key',
          id: 'ffgpt-keyboard',
          actions: [
            { type: 'keyDown', value: key },
            { type: 'keyUp', value: key },
          ],
        },
      ],
    });
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.connected = false;
    this.socket = undefined;
    if (socket === undefined) {
      return;
    }

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new BrowserConnectionError('The Firefox WebDriver BiDi connection was closed.'),
      );
    }
    this.pending.clear();
    await this.closeSocket(socket);
  }

  private async command<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      throw new BrowserConnectionError(this.connectionFailureMessage());
    }

    const id = this.nextCommandId++;
    const message = JSON.stringify({ id, method, params });
    const response = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BrowserCommandTimeoutError(method, this.timeoutMs));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
    });

    try {
      socket.send(message);
    } catch (error: unknown) {
      const pending = this.pending.get(id);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      throw new BrowserConnectionError(`Could not send Firefox WebDriver BiDi command ${method}.`, {
        cause: error,
      });
    }

    return response;
  }

  private installSocketHandlers(socket: WebSocket): void {
    socket.on('message', (data: RawData) => {
      this.handleMessage(data);
    });
    socket.on('error', (error: Error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new BrowserConnectionError(this.connectionFailureMessage(error), { cause: error }),
        );
      }
      this.pending.clear();
    });
    socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new BrowserConnectionError(
            wasConnected
              ? 'Firefox closed the WebDriver BiDi connection while an operation was running.'
              : this.connectionFailureMessage(),
          ),
        );
      }
      this.pending.clear();
    });
  }

  private handleMessage(data: RawData): void {
    let message: BiDiCommandResponse<unknown>;
    try {
      message = JSON.parse(data.toString()) as BiDiCommandResponse<unknown>;
    } catch {
      return;
    }
    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.type === 'error') {
      const detail = message.message ?? message.error ?? 'Unknown WebDriver BiDi error';
      pending.reject(
        new BrowserProtocolError(`${pending.method} failed: ${detail}`, pending.method),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private async waitForSocketOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) {
      return;
    }
    await this.withTimeout(
      new Promise<void>((resolve, reject) => {
        const onOpen = (): void => resolve();
        const onError = (error: Error): void => reject(error);
        socket.once('open', onOpen);
        socket.once('error', onError);
      }),
      'connection',
    );
  }

  private async closeSocket(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(
        () => {
          socket.terminate();
          resolve();
        },
        Math.min(this.timeoutMs, 1_000),
      );
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, 'ffgpt disconnect');
    });
  }

  private async withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new BrowserCommandTimeoutError(operation, this.timeoutMs)),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private ensureConnected(): void {
    if (!this.connected || this.socket === undefined) {
      throw new BrowserConnectionError(this.connectionFailureMessage());
    }
  }

  private connectionFailureMessage(error?: unknown): string {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    return `Could not connect to Firefox at ${this.host}:${this.port}${detail}. Start Firefox with remote debugging enabled, for example: firefox --remote-debugging-port ${this.port}`;
  }
}

function toRemoteValue(value: unknown): BiDiRemoteValue {
  if (value === null) {
    return { type: 'null' };
  }
  if (typeof value === 'string') {
    return { type: 'string', value };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', value };
  }
  if (typeof value === 'number') {
    return { type: 'number', value };
  }
  if (Array.isArray(value)) {
    return { type: 'array', value: value.map(toRemoteValue) };
  }
  if (typeof value === 'object' && value !== null) {
    return {
      type: 'object',
      value: Object.entries(value).map(([key, entry]) => [key, toRemoteValue(entry)]),
    };
  }
  throw new BrowserProtocolError(
    `Unsupported script argument type: ${typeof value}.`,
    'script.callFunction',
  );
}

function fromRemoteValue(value: BiDiRemoteValue): unknown {
  if (value.type === 'array' && Array.isArray(value.value)) {
    return value.value.map((entry) => fromRemoteValue(entry as BiDiRemoteValue));
  }
  if (value.type === 'object' && Array.isArray(value.value)) {
    return Object.fromEntries(
      value.value.map((entry) => {
        const [key, remoteValue] = entry as [string, BiDiRemoteValue];
        return [key, fromRemoteValue(remoteValue)];
      }),
    );
  }
  return value.value;
}

function formatException(exception: unknown): string {
  if (typeof exception === 'object' && exception !== null && 'text' in exception) {
    const text = (exception as { text?: unknown }).text;
    if (typeof text === 'string') {
      return text;
    }
  }
  return 'unknown page exception';
}
