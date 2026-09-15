import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { ConfigError } from '../errors/index.js';

export const DEFAULT_BROWSER_HOST = '127.0.0.1';
export const DEFAULT_BROWSER_PORT = 9222;
export const DEFAULT_TIMEOUT_MS = 5_000;

const CHATGPT_HOSTNAMES = new Set(['chatgpt.com', 'www.chatgpt.com']);

export interface BrowserConfig {
  host: string;
  port: number;
  timeoutMs: number;
}

export interface FfgptConfig {
  browser: BrowserConfig;
  projects: Record<string, string>;
  defaultProject?: string;
  configPath: string;
  configFileLoaded: boolean;
}

export interface ConfigOverrides {
  host?: string;
  port?: string | number;
  timeoutMs?: string | number;
}

export interface LoadConfigOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  overrides?: ConfigOverrides;
}

interface RawConfig {
  browser?: unknown;
  projects?: unknown;
  defaultProject?: unknown;
}

export function getConfigPath(
  options: {
    env?: NodeJS.ProcessEnv;
    homeDirectory?: string;
    platform?: NodeJS.Platform;
  } = {},
): string {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const configDirectory =
    platform === 'win32'
      ? env.APPDATA || path.join(homeDirectory, 'AppData', 'Roaming')
      : env.XDG_CONFIG_HOME || path.join(homeDirectory, '.config');

  return path.join(configDirectory, 'ffgpt', 'config.yaml');
}

export function isAllowedChatGptUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return url.protocol === 'https:' && CHATGPT_HOSTNAMES.has(url.hostname.toLowerCase());
}

export function resolveProjectAlias(
  config: FfgptConfig,
  requestedAlias?: string,
): string | undefined {
  const alias = requestedAlias ?? config.defaultProject;
  if (alias === undefined) {
    return undefined;
  }

  const projectUrl = config.projects[alias];
  if (projectUrl === undefined) {
    const available = Object.keys(config.projects).sort();
    const suffix =
      available.length > 0
        ? ` Available aliases: ${available.join(', ')}.`
        : ' No aliases are configured.';
    throw new ConfigError(`Unknown ChatGPT Project alias "${alias}".${suffix}`);
  }

  return projectUrl;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<FfgptConfig> {
  const env = options.env ?? process.env;
  const configPath =
    options.configPath ??
    env.FFGPT_CONFIG ??
    getConfigPath({
      env,
      ...(options.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory }),
      ...(options.platform === undefined ? {} : { platform: options.platform }),
    });

  try {
    const fileConfig = await readConfigFile(configPath);
    const config = validateFileConfig(fileConfig, configPath);
    const overrides = options.overrides ?? {};

    const host = parseHost(overrides.host ?? env.FFGPT_HOST ?? config.browser.host, 'browser.host');
    const port = parsePort(overrides.port ?? env.FFGPT_PORT ?? config.browser.port, 'browser.port');
    const timeoutMs = parsePositiveInteger(
      overrides.timeoutMs ?? env.FFGPT_TIMEOUT_MS ?? config.browser.timeoutMs,
      'browser.timeoutMs',
    );

    return {
      browser: { host, port, timeoutMs },
      projects: config.projects,
      ...(config.defaultProject === undefined ? {} : { defaultProject: config.defaultProject }),
      configPath,
      configFileLoaded: fileConfig !== undefined,
    };
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(errorMessage(error), { cause: error });
  }
}

async function readConfigFile(configPath: string): Promise<RawConfig | undefined> {
  try {
    await access(configPath);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`Unable to access configuration file ${configPath}: ${errorMessage(error)}`);
  }

  let contents: string;
  try {
    contents = await readFile(configPath, 'utf8');
  } catch (error: unknown) {
    throw new Error(`Unable to read configuration file ${configPath}: ${errorMessage(error)}`);
  }

  try {
    const parsed: unknown = YAML.parse(contents);
    if (parsed === null || parsed === undefined) {
      return {};
    }
    if (!isRecord(parsed)) {
      throw new Error('the document root must be a mapping');
    }
    return parsed as RawConfig;
  } catch (error: unknown) {
    throw new Error(`Invalid configuration file ${configPath}: ${errorMessage(error)}`);
  }
}

function validateFileConfig(
  value: RawConfig | undefined,
  configPath: string,
): {
  browser: { host: string; port: number; timeoutMs: number };
  projects: Record<string, string>;
  defaultProject?: string;
} {
  const raw = value ?? {};
  const browser =
    raw.browser === undefined ? {} : requireRecord(raw.browser, `${configPath}: browser`);
  const host =
    browser.host === undefined
      ? DEFAULT_BROWSER_HOST
      : parseHost(browser.host, `${configPath}: browser.host`);
  const port =
    browser.port === undefined
      ? DEFAULT_BROWSER_PORT
      : parsePort(browser.port, `${configPath}: browser.port`);
  const timeoutMs =
    browser.timeoutMs === undefined
      ? DEFAULT_TIMEOUT_MS
      : parsePositiveInteger(browser.timeoutMs, `${configPath}: browser.timeoutMs`);

  const projects = raw.projects === undefined ? {} : validateProjects(raw.projects, configPath);
  let defaultProject: string | undefined;
  if (raw.defaultProject !== undefined) {
    if (typeof raw.defaultProject !== 'string' || raw.defaultProject.length === 0) {
      throw new Error(`${configPath}: defaultProject must be a non-empty alias string`);
    }
    if (!(raw.defaultProject in projects)) {
      throw new Error(
        `${configPath}: defaultProject "${raw.defaultProject}" is not configured in projects`,
      );
    }
    defaultProject = raw.defaultProject;
  }

  return {
    browser: { host, port, timeoutMs },
    projects,
    ...(defaultProject === undefined ? {} : { defaultProject }),
  };
}

function validateProjects(value: unknown, configPath: string): Record<string, string> {
  const projects = requireRecord(value, `${configPath}: projects`);
  const result: Record<string, string> = {};
  for (const [alias, url] of Object.entries(projects)) {
    if (alias.length === 0) {
      throw new Error(`${configPath}: project aliases must not be empty`);
    }
    if (typeof url !== 'string' || !isAllowedChatGptUrl(url)) {
      throw new Error(
        `${configPath}: project "${alias}" must be an HTTPS URL on chatgpt.com or www.chatgpt.com`,
      );
    }
    result[alias] = url;
  }
  return result;
}

function parseHost(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\s/\\]/.test(value)) {
    throw new Error(`${field} must be a non-empty host name`);
  }
  return value;
}

function parsePort(value: unknown, field: string): number {
  const port = parsePositiveInteger(value, field);
  if (port > 65_535) {
    throw new Error(`${field} must be between 1 and 65535`);
  }
  return port;
}

function parsePositiveInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
