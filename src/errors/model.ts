export const EXIT_CODES = {
  success: 0,
  usage: 2,
  config: 3,
  browser: 4,
  chatGPT: 5,
  submission: 6,
  confirmation: 7,
  timeout: 8,
  internal: 1,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
export type FfgptErrorKind =
  | 'usage'
  | 'config'
  | 'browser-connection'
  | 'browser-protocol'
  | 'chatgpt-not-ready'
  | 'navigation'
  | 'submission'
  | 'submission-not-confirmed'
  | 'timeout'
  | 'internal';

export class FfgptError extends Error {
  readonly kind: FfgptErrorKind;
  readonly exitCode: ExitCode;
  readonly expected = true;

  constructor(kind: FfgptErrorKind, exitCode: ExitCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FfgptError';
    this.kind = kind;
    this.exitCode = exitCode;
  }
}

export class UsageError extends FfgptError {
  constructor(message: string, options?: ErrorOptions) {
    super('usage', EXIT_CODES.usage, message, options);
    this.name = 'UsageError';
  }
}

export class ConfigError extends FfgptError {
  constructor(message: string, options?: ErrorOptions) {
    super('config', EXIT_CODES.config, message, options);
    this.name = 'ConfigError';
  }
}

export type BrowserErrorCode = 'connection' | 'protocol' | 'timeout';

export class BrowserDriverError extends FfgptError {
  readonly code: BrowserErrorCode;

  constructor(code: BrowserErrorCode, message: string, options?: ErrorOptions) {
    super(
      code === 'connection'
        ? 'browser-connection'
        : code === 'protocol'
          ? 'browser-protocol'
          : 'timeout',
      code === 'timeout' ? EXIT_CODES.timeout : EXIT_CODES.browser,
      message,
      options,
    );
    this.name = 'BrowserDriverError';
    this.code = code;
  }
}

export class BrowserConnectionError extends BrowserDriverError {
  constructor(message: string, options?: ErrorOptions) {
    super('connection', message, options);
    this.name = 'BrowserConnectionError';
  }
}

export class BrowserProtocolError extends BrowserDriverError {
  readonly method?: string;

  constructor(message: string, method?: string, options?: ErrorOptions) {
    super('protocol', message, options);
    this.name = 'BrowserProtocolError';
    if (method !== undefined) {
      this.method = method;
    }
  }
}

export class TimeoutError extends BrowserDriverError {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number, options?: ErrorOptions) {
    super('timeout', `${operation} timed out after ${timeoutMs} ms.`, options);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export class BrowserCommandTimeoutError extends TimeoutError {
  constructor(operation: string, timeoutMs: number) {
    super(`Firefox WebDriver BiDi ${operation}`, timeoutMs);
    this.name = 'BrowserCommandTimeoutError';
  }
}

export type ChatGPTErrorCode = 'navigation' | 'not-ready' | 'submission' | 'confirmation';

export class ChatGPTAdapterError extends FfgptError {
  readonly code: ChatGPTErrorCode;

  constructor(code: ChatGPTErrorCode, message: string, options?: ErrorOptions) {
    super(
      code === 'navigation'
        ? 'navigation'
        : code === 'not-ready'
          ? 'chatgpt-not-ready'
          : code === 'submission'
            ? 'submission'
            : 'submission-not-confirmed',
      code === 'submission'
        ? EXIT_CODES.submission
        : code === 'confirmation'
          ? EXIT_CODES.confirmation
          : EXIT_CODES.chatGPT,
      message,
      options,
    );
    this.name = 'ChatGPTAdapterError';
    this.code = code;
  }
}

export class ChatGPTNotReadyError extends ChatGPTAdapterError {
  constructor(message: string, options?: ErrorOptions) {
    super('not-ready', message, options);
    this.name = 'ChatGPTNotReadyError';
  }
}

export class NavigationError extends ChatGPTAdapterError {
  constructor(message: string, options?: ErrorOptions) {
    super('navigation', message, options);
    this.name = 'NavigationError';
  }
}

export class SubmissionError extends ChatGPTAdapterError {
  constructor(message: string, options?: ErrorOptions) {
    super('submission', message, options);
    this.name = 'SubmissionError';
  }
}

export class SubmissionNotConfirmedError extends ChatGPTAdapterError {
  constructor(message: string, options?: ErrorOptions) {
    super('confirmation', message, options);
    this.name = 'SubmissionNotConfirmedError';
  }
}

export class InternalError extends FfgptError {
  constructor(message: string, options?: ErrorOptions) {
    super('internal', EXIT_CODES.internal, message, options);
    this.name = 'InternalError';
  }
}

export function isFfgptError(error: unknown): error is FfgptError {
  return error instanceof FfgptError;
}

export function toFfgptError(error: unknown): FfgptError {
  if (isFfgptError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new InternalError(message, error instanceof Error ? { cause: error } : undefined);
}

export function formatError(error: unknown, options: { verbose?: boolean } = {}): string {
  const normalized = toFfgptError(error);
  const lines = [normalized.message];
  if (options.verbose) {
    lines.push(`category: ${normalized.kind}; exit code: ${normalized.exitCode}`);
    if (normalized.cause instanceof Error) {
      lines.push(`cause: ${sanitizeErrorText(normalized.cause.message)}`);
    }
  }
  return `${lines.map(sanitizeErrorText).join('\n')}\n`;
}

function sanitizeErrorText(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:authorization|cookie|token|password|secret|session(?:storage)?|api[-_]?key)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /([?&](?:token|access_token|refresh_token|password|secret|api_key|session)=[^&#\s]*)/gi,
      (match) => {
        const index = match.indexOf('=');
        return `${match.slice(0, index)}=[REDACTED]`;
      },
    );
}
