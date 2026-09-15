import { Buffer } from 'node:buffer';
import { isAllowedChatGptUrl, loadConfig, resolveProjectAlias } from '../config/index.js';
import type { FfgptConfig, LoadConfigOptions } from '../config/index.js';
import { FirefoxBiDiDriver } from '../browser/index.js';
import type { BrowserDriver } from '../browser/index.js';
import { ChatGPTAdapter } from '../chatgpt/index.js';
import {
  BrowserConnectionError,
  FfgptError,
  SubmissionError,
  toFfgptError,
} from '../errors/index.js';
import { readPrompt } from '../input/index.js';
import { createLogger, sanitizeLogMessage } from '../logging/logger.js';
import { createTimeoutPolicy } from '../timeouts.js';

export interface AskCommandOptions {
  project?: string;
  host?: string;
  port?: string;
  timeout?: string;
  verbose?: boolean;
}

export interface AskDependencies {
  stdin?: AsyncIterable<Uint8Array | string>;
  stdinIsTTY?: boolean;
  loadConfig?: (options: LoadConfigOptions) => Promise<FfgptConfig>;
  createDriver?: (config: FfgptConfig) => BrowserDriver;
  stdout?: (message: string) => void;
}

export async function runAsk(
  positionalPrompt: string | undefined,
  options: AskCommandOptions,
  dependencies: AskDependencies = {},
): Promise<void> {
  const finalPrompt = await readPrompt(positionalPrompt, {
    stdin: dependencies.stdin ?? process.stdin,
    stdinIsTTY: dependencies.stdinIsTTY ?? process.stdin.isTTY === true,
  });
  const logger = createLogger({
    ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
  });
  logger.verbose(`prompt accepted (${Buffer.byteLength(finalPrompt, 'utf8')} UTF-8 bytes)`);

  const overrides: LoadConfigOptions['overrides'] = {};
  if (options.host !== undefined) overrides.host = options.host;
  if (options.port !== undefined) overrides.port = options.port;
  if (options.timeout !== undefined) overrides.timeoutMs = options.timeout;
  const config = await (dependencies.loadConfig ?? loadConfig)({ overrides });
  const projectUrl = resolveProjectAlias(config, options.project);
  if (projectUrl !== undefined && !isAllowedChatGptUrl(projectUrl)) {
    throw new SubmissionError(
      'The resolved ChatGPT Project URL is not an allowed HTTPS ChatGPT URL.',
    );
  }
  const timeoutPolicy = createTimeoutPolicy(config.browser.timeoutMs);
  logger.verbose(`config path: ${config.configPath}`);
  if (projectUrl !== undefined) {
    logger.verbose(`project target: ${sanitizeLogMessage(sanitizeUrl(projectUrl))}`);
  }

  const createDriver =
    dependencies.createDriver ??
    ((value: FfgptConfig) =>
      new FirefoxBiDiDriver({
        host: value.browser.host,
        port: value.browser.port,
        timeoutMs: timeoutPolicy.connectionMs,
      }));
  const browser = createDriver(config);
  let failure: FfgptError | undefined;
  let cleanupFailure: FfgptError | undefined;

  try {
    logger.verbose('connecting to Firefox');
    await browser.connect();
    logger.verbose('Firefox WebDriver BiDi connected');

    const adapter = new ChatGPTAdapter({
      browser,
      composerTimeoutMs: timeoutPolicy.composerMs,
      confirmationTimeoutMs: timeoutPolicy.confirmationMs,
    });
    await adapter.prepareTarget(projectUrl === undefined ? {} : { projectUrl });
    logger.verbose('ChatGPT target prepared');
    await adapter.sendPrompt(finalPrompt);
    logger.verbose('prompt submission confirmed');
  } catch (error: unknown) {
    failure = toFfgptError(error);
  } finally {
    try {
      await browser.disconnect();
      logger.verbose('Firefox WebDriver BiDi disconnected');
    } catch (error: unknown) {
      cleanupFailure =
        error instanceof FfgptError
          ? error
          : new BrowserConnectionError(
              'Could not safely disconnect the Firefox automation client.',
              {
                cause: error,
              },
            );
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
  (dependencies.stdout ?? ((message: string) => process.stdout.write(message)))(
    'Prompt submitted.\n',
  );
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[configured ChatGPT URL]';
  }
}
