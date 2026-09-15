import { describe, expect, it, vi } from 'vitest';
import { ChatGPTAdapter } from '../src/chatgpt/index.js';
import type { BrowserContextInfo, BrowserDriver } from '../src/browser/index.js';

class FakeBrowser implements BrowserDriver {
  readonly contexts: BrowserContextInfo[] = [{ id: 'chat', url: 'https://chatgpt.com/' }];
  readonly navigations: string[] = [];
  readonly evaluations: string[] = [];
  readonly pressedKeys: string[] = [];
  pageState: 'ready' | 'login' | 'composer-missing' = 'ready';
  composerText = '';
  confirmationText = '';
  confirmationStopVisible = false;
  confirmationUserMessageVisible = false;

  async connect(): Promise<void> {}

  async listContexts(): Promise<BrowserContextInfo[]> {
    return this.contexts;
  }

  async createContext(): Promise<string> {
    this.contexts.push({ id: 'created', url: 'about:blank' });
    return 'created';
  }

  async navigate(contextId: string, url: string): Promise<void> {
    this.navigations.push(`${contextId}:${url}`);
    const context = this.contexts.find((candidate) => candidate.id === contextId);
    if (context) context.url = url;
  }

  async evaluate<T>(_contextId: string, functionDeclaration: string): Promise<T> {
    this.evaluations.push(functionDeclaration);
    if (functionDeclaration.includes('loginVisible')) {
      return {
        status: this.pageState,
        composerSelector: '#prompt-textarea',
        composerText: this.composerText,
        sendSelector: 'button[data-testid="send-button"]',
      } as T;
    }
    if (functionDeclaration.includes('existingText')) {
      this.composerText = 'inserted prompt';
      return { ok: true, actualText: 'inserted prompt' } as T;
    }
    if (functionDeclaration.includes('button.click')) {
      return { dispatched: true, method: 'button' } as T;
    }
    return {
      composerText: this.confirmationText,
      stopVisible: this.confirmationStopVisible,
      userMessageVisible: this.confirmationUserMessageVisible,
    } as T;
  }

  async pressKey(_contextId: string, key: string): Promise<void> {
    this.pressedKeys.push(key);
  }

  async disconnect(): Promise<void> {}
}

describe('ChatGPTAdapter', () => {
  it('reuses an existing ChatGPT tab and confirms one submission', async () => {
    const browser = new FakeBrowser();
    browser.confirmationText = '';
    const adapter = new ChatGPTAdapter({ browser, sleep: vi.fn(async () => undefined) });

    await adapter.prepareTarget();
    await adapter.sendPrompt('inserted prompt');

    expect(browser.navigations).toEqual([]);
    expect(browser.evaluations.filter((source) => source.includes('button.click'))).toHaveLength(1);
  });

  it('navigates a ChatGPT tab to a configured project URL', async () => {
    const browser = new FakeBrowser();
    const adapter = new ChatGPTAdapter({ browser, sleep: vi.fn(async () => undefined) });

    await adapter.prepareTarget({ projectUrl: 'https://chatgpt.com/g/g-p-example/project' });

    expect(browser.navigations).toEqual(['chat:https://chatgpt.com/g/g-p-example/project']);
  });

  it('refuses to submit over an existing draft', async () => {
    const browser = new FakeBrowser();
    browser.composerText = 'keep this draft';
    const adapter = new ChatGPTAdapter({ browser, sleep: vi.fn(async () => undefined) });
    await adapter.prepareTarget();

    await expect(adapter.sendPrompt('new prompt')).rejects.toThrow('already contains a draft');
    expect(browser.evaluations.some((source) => source.includes('button.click'))).toBe(false);
  });

  it('does not retry after ambiguous confirmation', async () => {
    const browser = new FakeBrowser();
    browser.confirmationText = 'inserted prompt';
    const adapter = new ChatGPTAdapter({
      browser,
      timeoutMs: 1,
      sleep: vi.fn(async () => undefined),
    });
    await adapter.prepareTarget();

    await expect(adapter.sendPrompt('inserted prompt')).rejects.toThrow(
      'may already have been sent',
    );
    const submitCount = browser.evaluations.filter((source) =>
      source.includes('button.click'),
    ).length;
    await expect(adapter.sendPrompt('inserted prompt')).rejects.toThrow('already been issued');
    expect(browser.evaluations.filter((source) => source.includes('button.click'))).toHaveLength(
      submitCount,
    );
  });
});
