export interface Logger {
  verbose(message: string): void;
}

export interface LoggerOptions {
  verbose?: boolean;
  write?: (message: string) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((message: string) => process.stderr.write(`${message}\n`));
  return {
    verbose(message: string): void {
      if (options.verbose) {
        write(sanitizeLogMessage(message));
      }
    },
  };
}

export function sanitizeLogMessage(message: string): string {
  return message
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
