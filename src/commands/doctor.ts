import { isAllowedChatGptUrl, loadConfig } from '../config/index.js';
import type { FfgptConfig, LoadConfigOptions } from '../config/index.js';
import {
  BrowserConnectionError,
  BrowserProtocolError,
  ChatGPTNotReadyError,
  FfgptError,
  toFfgptError,
} from '../errors/index.js';
import type { BrowserDriver } from '../browser/index.js';
import { FirefoxBiDiDriver } from '../browser/index.js';
import { inspectChatGPTPage } from '../chatgpt/index.js';
import { createLogger, sanitizeLogMessage } from '../logging/logger.js';

export interface DoctorCommandOptions {
  host?: string;
  port?: string;
  timeout?: string;
  verbose?: boolean;
}

export type DoctorCheckStatus = 'ok' | 'warning' | 'error';

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
  hint?: string;
}

export interface DoctorDependencies {
  createDriver?: (config: FfgptConfig) => BrowserDriver;
  loadConfig?: (options: LoadConfigOptions) => Promise<FfgptConfig>;
  stdout?: (message: string) => void;
}

export async function runDoctor(
  options: DoctorCommandOptions,
  dependencies: DoctorDependencies = {},
): Promise<void> {
  const write = dependencies.stdout ?? ((message: string) => process.stdout.write(message));
  const logger = createLogger({
    ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
  });
  const checks: DoctorCheck[] = [];
  write('ffgpt doctor\n\n');

  const overrides: LoadConfigOptions['overrides'] = {};
  if (options.host !== undefined) overrides.host = options.host;
  if (options.port !== undefined) overrides.port = options.port;
  if (options.timeout !== undefined) overrides.timeoutMs = options.timeout;

  let config: FfgptConfig;
  try {
    config = await (dependencies.loadConfig ?? loadConfig)({ overrides });
    checks.push({
      name: 'config',
      status: 'ok',
      message: config.configFileLoaded
        ? `config loaded: ${config.configPath}; Firefox ${config.browser.host}:${config.browser.port}; timeout ${config.browser.timeoutMs}ms`
        : `config not found; using defaults (${config.configPath}); Firefox ${config.browser.host}:${config.browser.port}; timeout ${config.browser.timeoutMs}ms`,
    });
    logger.verbose(`config path: ${config.configPath}`);
    logger.verbose(`Firefox endpoint: ${config.browser.host}:${config.browser.port}`);
  } catch (error: unknown) {
    const failure = toFfgptError(error);
    checks.push({
      name: 'config',
      status: 'error',
      message: failure.message,
      hint: 'Fix the configuration file or remove it to use the built-in defaults.',
    });
    renderChecks(write, checks);
    throw failure;
  }

  const aliases = Object.keys(config.projects).sort();
  checks.push(
    aliases.length > 0
      ? {
          name: 'projects',
          status: 'ok',
          message: `project aliases configured: ${aliases.join(', ')}`,
        }
      : {
          name: 'projects',
          status: 'warning',
          message: 'no project aliases configured (optional)',
          hint: 'Add projects to the config file only if --project is needed.',
        },
  );

  const createDriver =
    dependencies.createDriver ??
    ((value: FfgptConfig) =>
      new FirefoxBiDiDriver({
        host: value.browser.host,
        port: value.browser.port,
        timeoutMs: value.browser.timeoutMs,
      }));
  const browser = createDriver(config);
  let failure: FfgptError | undefined;

  try {
    await browser.connect();
    checks.push({
      name: 'firefox',
      status: 'ok',
      message: `Firefox reachable: ${config.browser.host}:${config.browser.port}`,
    });
    checks.push({ name: 'bidi', status: 'ok', message: 'WebDriver BiDi session established' });
    logger.verbose('WebDriver BiDi session established');

    let contexts;
    try {
      contexts = await browser.listContexts();
      checks.push({
        name: 'contexts',
        status: 'ok',
        message: `browser contexts discovered: ${contexts.length}`,
      });
    } catch (error: unknown) {
      throw error instanceof FfgptError
        ? error
        : new BrowserProtocolError(
            'Could not enumerate Firefox browsing contexts.',
            'browsingContext.getTree',
            {
              cause: error,
            },
          );
    }

    const chatContext = contexts.find((context) => isAllowedChatGptUrl(context.url));
    if (chatContext === undefined) {
      throw new ChatGPTNotReadyError(
        'No ChatGPT tab found in Firefox. Open chatgpt.com in a logged-in tab and run doctor again.',
      );
    }
    checks.push({
      name: 'chatgpt-tab',
      status: 'ok',
      message: `ChatGPT tab found: ${sanitizeUrl(chatContext.url)}`,
    });

    let pageState;
    try {
      pageState = await inspectChatGPTPage(browser, chatContext.id);
    } catch (error: unknown) {
      throw error instanceof FfgptError
        ? error
        : new ChatGPTNotReadyError('Could not inspect the ChatGPT tab without modifying it.', {
            cause: error,
          });
    }
    if (pageState.status === 'login') {
      throw new ChatGPTNotReadyError(
        'ChatGPT is not logged in. Sign in to chatgpt.com in Firefox; doctor never enters credentials.',
      );
    }
    if (pageState.status !== 'ready') {
      throw new ChatGPTNotReadyError(
        'ChatGPT composer is not available. Open a normal logged-in chatgpt.com conversation and retry.',
      );
    }
    checks.push({ name: 'composer', status: 'ok', message: 'ChatGPT composer is ready' });
  } catch (error: unknown) {
    failure = toFfgptError(error);
    checks.push(failureCheck(failure, config.browser.port));
  } finally {
    try {
      await browser.disconnect();
    } catch (error: unknown) {
      if (failure === undefined) {
        failure =
          error instanceof FfgptError
            ? error
            : new BrowserConnectionError('Could not safely disconnect the WebDriver BiDi client.', {
                cause: error,
              });
        checks.push(failureCheck(failure, config.browser.port));
      }
    }
  }

  renderChecks(write, checks);
  if (failure !== undefined) {
    throw failure;
  }
  write('\nReady to send prompts.\n');
}

function failureCheck(error: FfgptError, port = 9222): DoctorCheck {
  const hint =
    error.kind === 'browser-connection' || error.kind === 'browser-protocol'
      ? `Start Firefox with remote debugging enabled, for example: firefox --remote-debugging-port ${port}`
      : error.kind === 'timeout'
        ? 'Check Firefox responsiveness and increase --timeout if the local machine is busy.'
        : error.kind === 'chatgpt-not-ready'
          ? 'Open Firefox, sign in to chatgpt.com, and leave a usable composer visible.'
          : undefined;
  return {
    name: error.kind,
    status: 'error',
    message: sanitizeLogMessage(error.message),
    ...(hint === undefined ? {} : { hint }),
  };
}

function renderChecks(write: (message: string) => void, checks: readonly DoctorCheck[]): void {
  for (const check of checks) {
    const marker = check.status === 'ok' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
    write(`${marker} ${check.message}\n`);
    if (check.hint !== undefined) {
      write(`  ${check.hint}\n`);
    }
  }
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[unavailable]';
  }
}
