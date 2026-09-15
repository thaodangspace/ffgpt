import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runAsk } from '../src/commands/ask.js';
import type { FfgptConfig } from '../src/config/index.js';
import type { BrowserContextInfo, BrowserDriver } from '../src/browser/index.js';
import { BrowserConnectionError, ConfigError, UsageError } from '../src/errors/index.js';

const config: FfgptConfig = {
  browser: { host: '127.0.0.1', port: 9222, timeoutMs: 1000 },
  projects: { coding: 'https://chatgpt.com/g/g-p-example/project' },
  configPath: '/tmp/ffgpt/config.yaml',
  configFileLoaded: true,
};

class FakeAskBrowser implements BrowserDriver {
  readonly contexts: BrowserContextInfo[] = [{ id: 'chat', url: 'https://chatgpt.com/' }];
  readonly insertedPrompts: string[] = [];
  connectCount = 0;
  disconnectCount = 0;
  evaluateCount = 0;
  failConnect = false;
  failInsertion = false;

  async connect(): Promise<void> {
    this.connectCount += 1;
    if (this.failConnect) {
      throw new BrowserConnectionError('connection failed');
    }
  }

  async listContexts(): Promise<BrowserContextInfo[]> {
    return this.contexts;
  }

  async createContext(): Promise<string> {
    return 'new-context';
  }

  async navigate(): Promise<void> {}

  async evaluate<T>(
    _contextId: string,
    functionDeclaration: string,
    args?: readonly unknown[],
  ): Promise<T> {
    this.evaluateCount += 1;
    if (functionDeclaration.includes('loginVisible')) {
      return {
        status: 'ready',
        composerSelector: '#prompt-textarea',
        composerText: '',
        sendSelector: 'button[data-testid="send-button"]',
      } as T;
    }
    if (functionDeclaration.includes('existingText')) {
      const prompt = String(args?.[0] ?? '');
      this.insertedPrompts.push(prompt);
      return {
        ok: true,
        actualText: this.failInsertion ? 'different prompt' : prompt,
      } as T;
    }
    if (functionDeclaration.includes('button.click')) {
      return { dispatched: true, method: 'button' } as T;
    }
    return { composerText: '', stopVisible: false, userMessageCount: 1 } as T;
  }

  async pressKey(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
  }
}

describe('ffgpt ask orchestration', () => {
  it('builds input, resolves config, submits, and disconnects', async () => {
    const browser = new FakeAskBrowser();
    const output: string[] = [];

    await runAsk(
      'Review this',
      {},
      {
        stdin: Readable.from(['diff\n']),
        stdinIsTTY: false,
        loadConfig: async () => config,
        createDriver: () => browser,
        stdout: (message) => output.push(message),
      },
    );

    expect(browser.insertedPrompts).toEqual(['Review this\n\ndiff']);
    expect(browser.connectCount).toBe(1);
    expect(browser.disconnectCount).toBe(1);
    expect(output).toEqual(['Prompt submitted.\n']);
  });

  it('rejects empty input before creating or connecting a browser', async () => {
    let created = false;
    await expect(
      runAsk(
        undefined,
        {},
        {
          stdin: Readable.from([]),
          stdinIsTTY: false,
          loadConfig: async () => config,
          createDriver: () => {
            created = true;
            return new FakeAskBrowser();
          },
        },
      ),
    ).rejects.toBeInstanceOf(UsageError);
    expect(created).toBe(false);
  });

  it('resolves project aliases before browser automation', async () => {
    let created = false;
    await expect(
      runAsk(
        'prompt',
        { project: 'missing' },
        {
          stdin: Readable.from([]),
          stdinIsTTY: false,
          loadConfig: async () => config,
          createDriver: () => {
            created = true;
            return new FakeAskBrowser();
          },
        },
      ),
    ).rejects.toBeInstanceOf(ConfigError);
    expect(created).toBe(false);
  });

  it('disconnects after a connection failure', async () => {
    const browser = new FakeAskBrowser();
    browser.failConnect = true;

    await expect(
      runAsk(
        'prompt',
        {},
        {
          stdin: Readable.from([]),
          stdinIsTTY: false,
          loadConfig: async () => config,
          createDriver: () => browser,
        },
      ),
    ).rejects.toBeInstanceOf(BrowserConnectionError);
    expect(browser.disconnectCount).toBe(1);
    expect(browser.evaluateCount).toBe(0);
  });

  it('disconnects after a submission failure', async () => {
    const browser = new FakeAskBrowser();
    browser.failInsertion = true;

    await expect(
      runAsk(
        'prompt',
        {},
        {
          stdin: Readable.from([]),
          stdinIsTTY: false,
          loadConfig: async () => config,
          createDriver: () => browser,
        },
      ),
    ).rejects.toThrow('did not contain the requested prompt');
    expect(browser.disconnectCount).toBe(1);
  });
});
