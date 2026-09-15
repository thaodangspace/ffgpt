export type ChatGPTErrorCode = 'navigation' | 'not-ready' | 'submission' | 'confirmation';

export class ChatGPTAdapterError extends Error {
  readonly code: ChatGPTErrorCode;

  constructor(code: ChatGPTErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ChatGPTAdapterError';
    this.code = code;
  }
}

export class NavigationError extends ChatGPTAdapterError {
  constructor(message: string, options?: ErrorOptions) {
    super('navigation', message, options);
    this.name = 'NavigationError';
  }
}

export class ChatGPTNotReadyError extends ChatGPTAdapterError {
  constructor(message: string, options?: ErrorOptions) {
    super('not-ready', message, options);
    this.name = 'ChatGPTNotReadyError';
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
