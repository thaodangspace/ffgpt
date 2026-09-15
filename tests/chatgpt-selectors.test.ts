import { describe, expect, it } from 'vitest';
import { COMPOSER_SELECTORS, SEND_BUTTON_SELECTORS, chooseSelector } from '../src/chatgpt/index.js';

describe('ChatGPT selector priority', () => {
  it('chooses the first matching composer selector', () => {
    const selected = chooseSelector(COMPOSER_SELECTORS, [
      '[role="textbox"][contenteditable="true"]',
      '#prompt-textarea',
    ]);
    expect(selected?.name).toBe('prompt-textarea-id');
  });

  it('falls back to a semantic send selector', () => {
    const selected = chooseSelector(SEND_BUTTON_SELECTORS, ['form button[type="submit"]']);
    expect(selected?.name).toBe('form-submit');
  });

  it('returns no selector when none matches', () => {
    expect(chooseSelector(COMPOSER_SELECTORS, ['.not-present'])).toBeUndefined();
  });
});
