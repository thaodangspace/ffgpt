import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { COMPOSER_SELECTORS, SEND_BUTTON_SELECTORS, chooseSelector } from '../src/chatgpt/index.js';

const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'chatgpt-composer.html');

describe('ChatGPT synthetic fixtures', () => {
  it('finds the preferred composer and send selectors without private session data', async () => {
    const html = await readFile(fixturePath, 'utf8');
    const { document } = parseHTML(html);
    const composerMatches = COMPOSER_SELECTORS.filter((candidate) =>
      document.querySelector(candidate.selector),
    ).map((candidate) => candidate.selector);
    const sendMatches = SEND_BUTTON_SELECTORS.filter((candidate) =>
      document.querySelector(candidate.selector),
    ).map((candidate) => candidate.selector);

    expect(chooseSelector(COMPOSER_SELECTORS, composerMatches)?.name).toBe('prompt-textarea-id');
    expect(chooseSelector(SEND_BUTTON_SELECTORS, sendMatches)?.name).toBe('send-test-id');
    expect(html).not.toMatch(/cookie|token|session storage|conversation/i);
  });
});
