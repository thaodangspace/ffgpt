import { isAllowedChatGptUrl } from '../config/index.js';
import type { BrowserContextInfo, BrowserDriver } from '../browser/index.js';
import { FfgptError } from '../errors/index.js';
import {
  ChatGPTNotReadyError,
  NavigationError,
  SubmissionError,
  SubmissionNotConfirmedError,
} from './errors.js';
import {
  COMPOSER_SELECTORS,
  SEND_BUTTON_SELECTORS,
  STOP_BUTTON_SELECTORS,
  selectorNames,
} from './selectors.js';

export const CHATGPT_HOME_URL = 'https://chatgpt.com/';
export const ENTER_KEY = '\uE007';

export interface PrepareTargetOptions {
  projectUrl?: string;
}

export interface ChatGPTAdapterOptions {
  browser: BrowserDriver;
  timeoutMs?: number;
  composerTimeoutMs?: number;
  confirmationTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ChatGPTPageState {
  status: 'ready' | 'login' | 'unsupported' | 'composer-missing';
  composerSelector?: string;
  composerText?: string;
  sendSelector?: string;
}

interface InsertResult {
  ok: boolean;
  reason?: 'composer-missing' | 'existing-draft' | 'content-mismatch';
  actualText?: string;
}

interface SubmitResult {
  dispatched: boolean;
  method?: 'button' | 'keyboard';
}

interface ConfirmationState {
  composerText: string;
  stopVisible: boolean;
  userMessageCount: number;
}

export const INSPECT_PAGE_FUNCTION = `function (composerSelectors, sendSelectors) {
  const find = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return { element, selector };
    }
    return undefined;
  };
  const readText = (element) => {
    if ('value' in element && typeof element.value === 'string') return element.value;
    return element.innerText ?? element.textContent ?? '';
  };
  const loginVisible = Boolean(
    location.pathname.includes('/auth/') ||
      document.querySelector(
        'a[href*="/auth/login"], form[action*="/auth/login"], [data-testid="login-button"]',
      ),
  );
  if (loginVisible) return { status: 'login' };
  const composer = find(composerSelectors);
  if (!composer) return { status: 'composer-missing' };
  const send = find(sendSelectors);
  return {
    status: 'ready',
    composerSelector: composer.selector,
    composerText: readText(composer.element),
    ...(send ? { sendSelector: send.selector } : {}),
  };
}`;

const INSERT_PROMPT_FUNCTION = `function (text, composerSelectors) {
  const find = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return undefined;
  };
  const readText = (element) => {
    if ('value' in element && typeof element.value === 'string') return element.value;
    return element.innerText ?? element.textContent ?? '';
  };
  const composer = find(composerSelectors);
  if (!composer) return { ok: false, reason: 'composer-missing' };
  const existingText = readText(composer);
  if (existingText.length > 0) return { ok: false, reason: 'existing-draft', actualText: existingText };
  composer.focus();
  let inserted = false;
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(composer, text);
    else composer.value = text;
    inserted = true;
  } else {
    composer.textContent = '';
    inserted = document.execCommand('insertText', false, text);
    if (!inserted) composer.textContent = text;
  }
  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  const actualText = readText(composer);
  return { ok: actualText.replace(/\\r\\n/g, '\\n') === text.replace(/\\r\\n/g, '\\n'), actualText };
}`;

const SUBMIT_FUNCTION = `function (composerSelectors, sendSelectors) {
  const find = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return undefined;
  };
  const button = find(sendSelectors);
  if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
    button.click();
    return { dispatched: true, method: 'button' };
  }
  const composer = find(composerSelectors);
  if (!composer) return { dispatched: false };
  composer.focus();
  return { dispatched: true, method: 'keyboard' };
}`;

const CONFIRMATION_FUNCTION = `function (composerSelectors, stopSelectors) {
  const find = (selectors) => selectors.some((selector) => Boolean(document.querySelector(selector)));
  const composer = (() => {
    for (const selector of composerSelectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return undefined;
  })();
  const composerText = composer
    ? ('value' in composer && typeof composer.value === 'string' ? composer.value : composer.innerText ?? composer.textContent ?? '')
    : '';
  const userMessageCount = document.querySelectorAll(
    '[data-message-author-role="user"], [data-testid*="conversation-turn-user"]',
  ).length;
  return {
    composerText,
    stopVisible: find(stopSelectors),
    userMessageCount,
  };
}`;

export class ChatGPTAdapter {
  private readonly browser: BrowserDriver;
  private readonly composerTimeoutMs: number;
  private readonly confirmationTimeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private contextId: string | undefined;
  private submissionActionIssued = false;

  constructor(options: ChatGPTAdapterOptions) {
    this.browser = options.browser;
    const defaultTimeout = options.timeoutMs ?? 5_000;
    this.composerTimeoutMs = options.composerTimeoutMs ?? defaultTimeout;
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? defaultTimeout;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async prepareTarget(options: PrepareTargetOptions = {}): Promise<void> {
    if (options.projectUrl !== undefined && !isAllowedChatGptUrl(options.projectUrl)) {
      throw new NavigationError(
        'The configured ChatGPT Project URL is not an allowed HTTPS ChatGPT URL.',
      );
    }

    let contexts: BrowserContextInfo[];
    try {
      contexts = await this.browser.listContexts();
    } catch (error: unknown) {
      if (error instanceof FfgptError) {
        throw error;
      }
      throw new NavigationError('Could not inspect Firefox browsing contexts.', { cause: error });
    }

    const targetUrl = options.projectUrl ?? CHATGPT_HOME_URL;
    const targetContext = await this.chooseContext(contexts, options.projectUrl);
    let contextId = targetContext?.id;
    if (contextId === undefined) {
      try {
        contextId = await this.browser.createContext();
      } catch (error: unknown) {
        if (error instanceof FfgptError) {
          throw error;
        }
        throw new NavigationError('Could not create a Firefox tab for ChatGPT.', { cause: error });
      }
    }

    const currentUrl = targetContext?.url;
    if (currentUrl === undefined || !sameUrl(currentUrl, targetUrl)) {
      try {
        await this.browser.navigate(contextId, targetUrl);
      } catch (error: unknown) {
        if (error instanceof FfgptError) {
          throw error;
        }
        throw new NavigationError(
          `Could not navigate the ChatGPT tab to ${sanitizeTargetUrl(targetUrl)}.`,
          {
            cause: error,
          },
        );
      }
    }

    this.contextId = contextId;
    await this.waitForReady();
  }

  async sendPrompt(text: string): Promise<void> {
    const contextId = this.contextId;
    if (contextId === undefined) {
      throw new SubmissionError('ChatGPT has not been prepared for prompt submission.');
    }
    if (this.submissionActionIssued) {
      throw new SubmissionError('A submission action has already been issued for this invocation.');
    }

    const page = await this.inspectPage(contextId);
    if (page.status !== 'ready') {
      throw this.notReadyError(page.status);
    }
    if (page.composerText !== undefined && page.composerText.length > 0) {
      throw new SubmissionError(
        'The ChatGPT composer already contains a draft. Clear the draft and retry so it is not combined silently.',
      );
    }

    const inserted = await this.browser.evaluate<InsertResult>(contextId, INSERT_PROMPT_FUNCTION, [
      text,
      selectorNames(COMPOSER_SELECTORS),
    ]);
    if (!inserted.ok) {
      if (inserted.reason === 'existing-draft') {
        throw new SubmissionError(
          'The ChatGPT composer already contains a draft. Clear the draft and retry so it is not combined silently.',
        );
      }
      throw new SubmissionError('Could not insert the prompt into the ChatGPT composer.');
    }
    if (normalizeText(inserted.actualText ?? '') !== normalizeText(text)) {
      throw new SubmissionError(
        'The ChatGPT composer did not contain the requested prompt after insertion.',
      );
    }

    let baseline: ConfirmationState;
    try {
      baseline = await this.browser.evaluate<ConfirmationState>(contextId, CONFIRMATION_FUNCTION, [
        selectorNames(COMPOSER_SELECTORS),
        selectorNames(STOP_BUTTON_SELECTORS),
      ]);
    } catch (error: unknown) {
      if (error instanceof FfgptError) {
        throw error;
      }
      throw new SubmissionError('Could not establish the pre-submit confirmation state.', {
        cause: error,
      });
    }

    this.submissionActionIssued = true;
    let submission: SubmitResult;
    try {
      submission = await this.browser.evaluate<SubmitResult>(contextId, SUBMIT_FUNCTION, [
        selectorNames(COMPOSER_SELECTORS),
        selectorNames(SEND_BUTTON_SELECTORS),
      ]);
      if (!submission.dispatched) {
        throw new SubmissionError('ChatGPT did not expose an enabled send control.');
      }
      if (submission.method === 'keyboard') {
        await this.browser.pressKey(contextId, ENTER_KEY);
      }
    } catch (error: unknown) {
      if (error instanceof SubmissionError) {
        throw error;
      }
      throw new SubmissionError('The prompt send action could not be dispatched.', {
        cause: error,
      });
    }

    await this.confirmSubmission(contextId, baseline);
  }

  private async chooseContext(
    contexts: BrowserContextInfo[],
    projectUrl: string | undefined,
  ): Promise<BrowserContextInfo | undefined> {
    if (projectUrl !== undefined) {
      const exact = contexts.find((context) => sameUrl(context.url, projectUrl));
      if (exact !== undefined) return exact;
    }

    const chatContexts = contexts.filter((context) => isChatGPTPageUrl(context.url));
    for (const context of chatContexts) {
      try {
        const state = await this.inspectPage(context.id);
        if (state.status === 'ready') return context;
      } catch (error: unknown) {
        if (error instanceof FfgptError) {
          throw error;
        }
        // A context may be transitioning. It can still be selected and waited on below.
      }
    }
    return chatContexts[0];
  }

  private async waitForReady(): Promise<void> {
    const contextId = this.contextId;
    if (contextId === undefined) {
      throw new ChatGPTNotReadyError('No ChatGPT browsing context is available.');
    }
    const deadline = Date.now() + this.composerTimeoutMs;
    let lastState: ChatGPTPageState | undefined;
    while (Date.now() <= deadline) {
      lastState = await this.inspectPage(contextId);
      if (lastState.status === 'ready') return;
      if (lastState.status === 'login') {
        throw this.notReadyError('login');
      }
      await this.sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    }

    if (lastState?.status === 'unsupported') {
      throw this.notReadyError('unsupported');
    }
    throw new ChatGPTNotReadyError(
      'ChatGPT composer was not ready before the timeout. Open a logged-in chatgpt.com tab and retry.',
    );
  }

  private async inspectPage(contextId: string): Promise<ChatGPTPageState> {
    try {
      return await inspectChatGPTPage(this.browser, contextId);
    } catch (error: unknown) {
      if (error instanceof FfgptError) {
        throw error;
      }
      throw new ChatGPTNotReadyError(
        'ChatGPT page inspection failed before the readiness timeout.',
        {
          cause: error,
        },
      );
    }
  }

  private async confirmSubmission(contextId: string, baseline: ConfirmationState): Promise<void> {
    const deadline = Date.now() + this.confirmationTimeoutMs;
    while (Date.now() <= deadline) {
      let state: ConfirmationState;
      try {
        state = await this.browser.evaluate<ConfirmationState>(contextId, CONFIRMATION_FUNCTION, [
          selectorNames(COMPOSER_SELECTORS),
          selectorNames(STOP_BUTTON_SELECTORS),
        ]);
      } catch (error: unknown) {
        throw new SubmissionNotConfirmedError(
          'The prompt may already have been submitted, but confirmation could not be read. Check the ChatGPT tab before retrying.',
          { cause: error },
        );
      }
      if (
        state.composerText.length === 0 ||
        (!baseline.stopVisible && state.stopVisible) ||
        state.userMessageCount > baseline.userMessageCount
      ) {
        return;
      }
      await this.sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    }

    throw new SubmissionNotConfirmedError(
      'The prompt submission could not be confirmed. It may already have been sent. Check the ChatGPT tab before retrying.',
    );
  }

  private notReadyError(status: ChatGPTPageState['status']): ChatGPTNotReadyError {
    if (status === 'login') {
      return new ChatGPTNotReadyError(
        'ChatGPT is not logged in. Sign in to chatgpt.com in Firefox, then retry; ffgpt never enters credentials.',
      );
    }
    if (status === 'unsupported') {
      return new ChatGPTNotReadyError(
        'The current page is not a usable ChatGPT page. Open chatgpt.com in Firefox and retry.',
      );
    }
    return new ChatGPTNotReadyError(
      'ChatGPT is not ready for prompt submission. Open a logged-in chatgpt.com tab and retry.',
    );
  }
}

export async function inspectChatGPTPage(
  browser: BrowserDriver,
  contextId: string,
): Promise<ChatGPTPageState> {
  return browser.evaluate<ChatGPTPageState>(contextId, INSPECT_PAGE_FUNCTION, [
    selectorNames(COMPOSER_SELECTORS),
    selectorNames(SEND_BUTTON_SELECTORS),
  ]);
}

function isChatGPTPageUrl(value: string): boolean {
  return isAllowedChatGptUrl(value);
}

function sameUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.href.replace(/\/$/u, '') === rightUrl.href.replace(/\/$/u, '');
  } catch {
    return false;
  }
}

function sanitizeTargetUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'configured ChatGPT URL';
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
