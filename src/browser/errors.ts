export class BrowserDriverError extends Error {
  readonly code: 'connection' | 'protocol' | 'timeout';

  constructor(
    code: 'connection' | 'protocol' | 'timeout',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
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

export class BrowserCommandTimeoutError extends BrowserDriverError {
  readonly operation: string;

  constructor(operation: string, timeoutMs: number) {
    super('timeout', `Firefox WebDriver BiDi ${operation} timed out after ${timeoutMs} ms.`);
    this.name = 'BrowserCommandTimeoutError';
    this.operation = operation;
  }
}
