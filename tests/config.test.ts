import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_HOST,
  DEFAULT_BROWSER_PORT,
  DEFAULT_TIMEOUT_MS,
  getConfigPath,
  isAllowedChatGptUrl,
  loadConfig,
  resolveProjectAlias,
} from '../src/config/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('configuration', () => {
  it('uses loopback defaults when no file exists', async () => {
    const config = await loadConfig({ configPath: '/tmp/ffgpt-config-does-not-exist.yaml' });

    expect(config.browser).toEqual({
      host: DEFAULT_BROWSER_HOST,
      port: DEFAULT_BROWSER_PORT,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    expect(config.projects).toEqual({});
    expect(config.configFileLoaded).toBe(false);
  });

  it('loads aliases and resolves the default project', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ffgpt-config-'));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, 'config.yaml');
    await writeFile(
      configPath,
      [
        'browser:',
        '  host: localhost',
        '  port: 9333',
        '  timeoutMs: 7000',
        'projects:',
        '  coding: https://chatgpt.com/g/g-p-example/project',
        'defaultProject: coding',
        '',
      ].join('\n'),
    );

    const config = await loadConfig({ configPath });
    expect(config.browser).toEqual({ host: 'localhost', port: 9333, timeoutMs: 7000 });
    expect(resolveProjectAlias(config)).toBe('https://chatgpt.com/g/g-p-example/project');
    expect(resolveProjectAlias(config, 'coding')).toBe('https://chatgpt.com/g/g-p-example/project');
  });

  it('applies environment and CLI precedence to browser settings', async () => {
    const config = await loadConfig({
      configPath: '/tmp/ffgpt-config-does-not-exist.yaml',
      env: { FFGPT_HOST: 'env.example', FFGPT_PORT: '9333', FFGPT_TIMEOUT_MS: '6000' },
      overrides: { host: 'cli.example', timeoutMs: 8000 },
    });

    expect(config.browser).toEqual({ host: 'cli.example', port: 9333, timeoutMs: 8000 });
  });

  it('rejects unknown aliases and lists available aliases', async () => {
    const config = await loadConfig({
      configPath: '/tmp/ffgpt-config-does-not-exist.yaml',
    });
    const withProjects = {
      ...config,
      projects: {
        coding: 'https://chatgpt.com/project/coding',
        work: 'https://chatgpt.com/project/work',
      },
    };

    expect(() => resolveProjectAlias(withProjects, 'missing')).toThrow(
      'Available aliases: coding, work',
    );
  });

  it('rejects unsafe project origins', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ffgpt-config-'));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, 'config.yaml');
    await writeFile(configPath, 'projects:\n  unsafe: https://example.com/project\n');

    await expect(loadConfig({ configPath })).rejects.toThrow('must be an HTTPS URL on chatgpt.com');
  });

  it('computes an XDG-aware path', () => {
    expect(
      getConfigPath({
        env: { XDG_CONFIG_HOME: '/tmp/config-home' },
        homeDirectory: '/tmp/home',
        platform: 'linux',
      }),
    ).toBe('/tmp/config-home/ffgpt/config.yaml');
  });

  it('only allows HTTPS ChatGPT origins', () => {
    expect(isAllowedChatGptUrl('https://chatgpt.com/project/one')).toBe(true);
    expect(isAllowedChatGptUrl('http://chatgpt.com/project/one')).toBe(false);
    expect(isAllowedChatGptUrl('https://chatgpt.com.evil.example/project')).toBe(false);
  });
});
