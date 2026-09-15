import { describe, expect, it, vi } from 'vitest';
import { createProgram, runCli } from '../src/cli.js';

describe('CLI command surface', () => {
  it('defines ask and doctor commands', () => {
    const program = createProgram();
    expect(program.commands.map((command) => command.name())).toEqual(['ask', 'doctor']);
  });

  it('passes ask options to the handler', async () => {
    const ask = vi.fn(async () => undefined);
    const code = await runCli(
      [
        'node',
        'ffgpt',
        'ask',
        '--project',
        'coding',
        '--host',
        'localhost',
        '--port',
        '9333',
        '--timeout',
        '1000',
        '--verbose',
        'hello',
      ],
      { ask },
    );

    expect(code).toBe(0);
    expect(ask).toHaveBeenCalledWith('hello', {
      project: 'coding',
      host: 'localhost',
      port: '9333',
      timeout: '1000',
      verbose: true,
    });
  });

  it('passes doctor options to the handler', async () => {
    const doctor = vi.fn(async () => undefined);
    const code = await runCli(['node', 'ffgpt', 'doctor', '--port', '9333'], { doctor });

    expect(code).toBe(0);
    expect(doctor).toHaveBeenCalledWith({ port: '9333' });
  });
});
