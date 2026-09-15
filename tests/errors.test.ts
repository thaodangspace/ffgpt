import { describe, expect, it } from 'vitest';
import {
  BrowserConnectionError,
  ConfigError,
  EXIT_CODES,
  SubmissionNotConfirmedError,
  TimeoutError,
  UsageError,
  formatError,
  toFfgptError,
} from '../src/errors/index.js';
import { createLogger, sanitizeLogMessage } from '../src/logging/logger.js';
import { createTimeoutPolicy } from '../src/timeouts.js';

describe('error model', () => {
  it('maps stable categories to documented exit codes', () => {
    expect(new UsageError('bad input').exitCode).toBe(2);
    expect(new ConfigError('bad config').exitCode).toBe(3);
    expect(new BrowserConnectionError('offline').exitCode).toBe(4);
    expect(new SubmissionNotConfirmedError('ambiguous').exitCode).toBe(7);
    expect(new TimeoutError('composer', 100).exitCode).toBe(8);
    expect(EXIT_CODES.internal).toBe(1);
  });

  it('keeps expected errors concise and hides causes unless verbose', () => {
    const error = new ConfigError('bad config', { cause: new Error('token=secret-value') });
    expect(formatError(error)).toBe('bad config\n');
    expect(formatError(error, { verbose: true })).toContain('token=[REDACTED]');
    expect(formatError(error, { verbose: true })).not.toContain('secret-value');
  });

  it('wraps unexpected failures as internal errors', () => {
    expect(toFfgptError(new Error('boom')).exitCode).toBe(1);
  });
});

describe('timeouts and logging', () => {
  it('names each timeout stage and keeps confirmation bounded', () => {
    expect(createTimeoutPolicy(9000)).toEqual({
      connectionMs: 9000,
      navigationMs: 9000,
      composerMs: 9000,
      confirmationMs: 2000,
    });
  });

  it('sanitizes secret-shaped values in verbose messages', () => {
    expect(sanitizeLogMessage('cookie=session=private token=abc https://x.test/?token=xyz')).toBe(
      'cookie=[REDACTED] token=[REDACTED] https://x.test/?token=[REDACTED]',
    );
    const messages: string[] = [];
    createLogger({ verbose: false, write: (message) => messages.push(message) }).verbose('hidden');
    expect(messages).toEqual([]);
  });
});
