import { Buffer } from 'node:buffer';
import { UsageError } from '../errors/index.js';

export const MAX_PROMPT_BYTES = 1_048_576;

export interface PromptReadOptions {
  stdin?: AsyncIterable<Uint8Array | string>;
  stdinIsTTY?: boolean;
  maxBytes?: number;
}

export function buildPrompt(
  positionalPrompt: string | undefined,
  stdinContent: string | undefined,
  maxBytes = MAX_PROMPT_BYTES,
): string {
  const instruction =
    positionalPrompt === undefined ? undefined : stripTrailingLineBreaks(positionalPrompt);
  const stdin = stdinContent === undefined ? undefined : removeOneFinalLineEnding(stdinContent);
  const prompt =
    instruction !== undefined && instruction.length > 0 && stdin !== undefined && stdin.length > 0
      ? `${instruction}\n\n${stdin}`
      : instruction !== undefined && instruction.length > 0
        ? instruction
        : stdin;

  if (prompt === undefined || prompt.trim().length === 0) {
    throw new UsageError(
      'Prompt is empty. Provide prompt text as an argument or through piped stdin.',
    );
  }
  assertWithinLimit(prompt, maxBytes);
  return prompt;
}

export async function readPrompt(
  positionalPrompt: string | undefined,
  options: PromptReadOptions = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_PROMPT_BYTES;
  const stdinIsTTY = options.stdinIsTTY ?? false;
  if (stdinIsTTY) {
    return buildPrompt(positionalPrompt, undefined, maxBytes);
  }

  const stdin = options.stdin;
  if (stdin === undefined) {
    return buildPrompt(positionalPrompt, undefined, maxBytes);
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of stdin) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > maxBytes) {
      throw new UsageError(`Prompt input exceeds the maximum size of ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  return buildPrompt(positionalPrompt, Buffer.concat(chunks).toString('utf8'), maxBytes);
}

function assertWithinLimit(value: string, maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new UsageError('Prompt maximum size must be a positive integer.');
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (byteLength > maxBytes) {
    throw new UsageError(`Prompt input exceeds the maximum size of ${maxBytes} bytes.`);
  }
}

function removeOneFinalLineEnding(value: string): string {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('\n') || value.endsWith('\r')) {
    return value.slice(0, -1);
  }
  return value;
}

function stripTrailingLineBreaks(value: string): string {
  return value.replace(/(?:\r\n|\r|\n)+$/u, '');
}
