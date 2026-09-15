import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildPrompt, readPrompt } from '../src/input/index.js';

describe('prompt input', () => {
  it('accepts a positional prompt', () => {
    expect(buildPrompt('Review this architecture', undefined)).toBe('Review this architecture');
  });

  it('preserves Unicode, multiline text, tabs, and indentation', () => {
    const prompt = '分析 this:\n\tconst value = 1;\n  return value;';
    expect(buildPrompt(prompt, undefined)).toBe(prompt);
  });

  it('uses stdin when no positional prompt is supplied', async () => {
    await expect(
      readPrompt(undefined, { stdin: Readable.from(['line 1\nline 2\n']), stdinIsTTY: false }),
    ).resolves.toBe('line 1\nline 2');
  });

  it('combines positional input and stdin with one blank line', async () => {
    await expect(
      readPrompt('Summarize this', {
        stdin: Readable.from(['line 1\nline 2\n']),
        stdinIsTTY: false,
      }),
    ).resolves.toBe('Summarize this\n\nline 1\nline 2');
  });

  it('does not read stdin when it is a TTY', async () => {
    const stdin = Readable.from(['stdin should not be consumed']);
    await expect(readPrompt('interactive prompt', { stdin, stdinIsTTY: true })).resolves.toBe(
      'interactive prompt',
    );
  });

  it('rejects empty and whitespace-only prompts', () => {
    expect(() => buildPrompt('', undefined)).toThrow('Prompt is empty');
    expect(() => buildPrompt('  \n\t', undefined)).toThrow('Prompt is empty');
  });

  it('does not silently discard stdin when the positional instruction is empty', async () => {
    await expect(
      readPrompt('', { stdin: Readable.from(['stdin content\n']), stdinIsTTY: false }),
    ).resolves.toBe('stdin content');
  });

  it('rejects oversized input before returning it', async () => {
    await expect(
      readPrompt(undefined, { stdin: Readable.from(['12345']), stdinIsTTY: false, maxBytes: 4 }),
    ).rejects.toThrow('maximum size of 4 bytes');
  });

  it('rejects an oversized combined prompt', () => {
    expect(() => buildPrompt('hello', 'world', 5)).toThrow('maximum size of 5 bytes');
  });
});
