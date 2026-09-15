import { describe, expect, it } from 'vitest';
import { buildBiDiEndpoint } from '../src/browser/index.js';

describe('Firefox WebDriver BiDi transport', () => {
  it('builds the Firefox session endpoint', () => {
    expect(buildBiDiEndpoint('127.0.0.1', 9222)).toBe('ws://127.0.0.1:9222/session');
  });

  it('brackets an IPv6 host', () => {
    expect(buildBiDiEndpoint('::1', 9222)).toBe('ws://[::1]:9222/session');
  });
});
