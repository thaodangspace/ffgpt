import { describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import type { FfgptConfig } from '../src/config/index.js';
import type { BrowserContextInfo, BrowserDriver } from '../src/browser/index.js';
import { ConfigError } from '../src/errors/index.js';

const config: FfgptConfig = {
  browser: { host: '127.0.0.1', port: 9222, timeoutMs: 1000 },
  projects: { coding: 'https://chatgpt.com/g/g-p-example/project' },
  defaultProject: 'coding',
  configPath: '/tmp/ffgpt/config.yaml',
  configFileLoaded: true,
};

class FakeDoctorBrowser implements BrowserDriver {
  connected = false;
  disconnected = false;
  contexts: BrowserContextInfo[] = [{ id: 'chat', url: 'https://chatgpt.com/' }];
  composerReady = true;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async listContexts(): Promise<BrowserContextInfo[]> {
    return this.contexts;
  }

  async createContext(): Promise<string> {
    throw new Error('doctor must not create contexts');
  }

  async navigate(): Promise<void> {
    throw new Error('doctor must not navigate');
  }

  async evaluate<T>(): Promise<T> {
    return {
      status: this.composerReady ? 'ready' : 'composer-missing',
      composerSelector: '#prompt-textarea',
      composerText: '',
    } as T;
  }

  async pressKey(): Promise<void> {
    throw new Error('doctor must not press keys');
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }
}

describe('ffgpt doctor', () => {
  it('runs read-only checks and disconnects the client', async () => {
    const browser = new FakeDoctorBrowser();
    const output: string[] = [];

    await runDoctor(
      {},
      {
        loadConfig: async () => config,
        createDriver: () => browser,
        stdout: (message) => output.push(message),
      },
    );

    const rendered = output.join('');
    expect(rendered).toContain('WebDriver BiDi session established');
    expect(rendered).toContain('ChatGPT composer is ready');
    expect(rendered).toContain('Ready to send prompts.');
    expect(browser.connected).toBe(true);
    expect(browser.disconnected).toBe(true);
  });

  it('fails when no ChatGPT tab exists and still disconnects', async () => {
    const browser = new FakeDoctorBrowser();
    browser.contexts = [{ id: 'other', url: 'https://example.com/' }];
    const output: string[] = [];

    await expect(
      runDoctor(
        {},
        {
          loadConfig: async () => config,
          createDriver: () => browser,
          stdout: (message) => output.push(message),
        },
      ),
    ).rejects.toThrow('No ChatGPT tab found');
    expect(output.join('')).toContain('Open chatgpt.com');
    expect(browser.disconnected).toBe(true);
  });

  it('does not connect when configuration loading fails', async () => {
    let created = false;
    await expect(
      runDoctor(
        {},
        {
          loadConfig: async () => {
            throw new ConfigError('invalid config');
          },
          createDriver: () => {
            created = true;
            return new FakeDoctorBrowser();
          },
        },
      ),
    ).rejects.toThrow('invalid config');
    expect(created).toBe(false);
  });
});
