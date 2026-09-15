export interface SelectorCandidate {
  name: string;
  selector: string;
}

/**
 * Selector order is intentionally centralized. Prefer semantic/test attributes before
 * role/contenteditable fallbacks, and keep structural selectors narrow.
 */
export const COMPOSER_SELECTORS: readonly SelectorCandidate[] = [
  { name: 'prompt-textarea-id', selector: '#prompt-textarea' },
  { name: 'textbox-test-id', selector: '[data-testid="textbox"]' },
  { name: 'textbox-contenteditable', selector: '[role="textbox"][contenteditable="true"]' },
  { name: 'contenteditable', selector: 'textarea, [contenteditable="true"]' },
];

export const SEND_BUTTON_SELECTORS: readonly SelectorCandidate[] = [
  { name: 'send-test-id', selector: 'button[data-testid="send-button"]' },
  { name: 'send-aria-label', selector: 'button[aria-label="Send prompt"]' },
  { name: 'send-aria-label-prefix', selector: 'button[aria-label^="Send"]' },
  { name: 'form-submit', selector: 'form button[type="submit"]' },
];

export const STOP_BUTTON_SELECTORS: readonly SelectorCandidate[] = [
  { name: 'stop-test-id', selector: 'button[data-testid="stop-button"]' },
  { name: 'stop-aria-label', selector: 'button[aria-label*="Stop"]' },
];

export function selectorNames(candidates: readonly SelectorCandidate[]): readonly string[] {
  return candidates.map((candidate) => candidate.selector);
}

export function chooseSelector(
  candidates: readonly SelectorCandidate[],
  matchingSelectors: readonly string[],
): SelectorCandidate | undefined {
  const matching = new Set(matchingSelectors);
  return candidates.find((candidate) => matching.has(candidate.selector));
}
