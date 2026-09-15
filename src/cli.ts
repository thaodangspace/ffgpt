#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import { runAsk, type AskCommandOptions } from './commands/ask.js';
import { runDoctor, type DoctorCommandOptions } from './commands/doctor.js';
import { EXIT_CODES, formatError, toFfgptError } from './errors/index.js';

export interface CliHandlers {
  ask?: (prompt: string | undefined, options: AskCommandOptions) => Promise<void>;
  doctor?: (options: DoctorCommandOptions) => Promise<void>;
}

export function createProgram(handlers: CliHandlers = {}): Command {
  const program = new Command();
  program
    .name('ffgpt')
    .description('Fire-and-forget prompts to ChatGPT through Firefox WebDriver BiDi')
    .version(packageJson.version)
    .showSuggestionAfterError()
    .exitOverride();

  program
    .command('ask')
    .description('submit a prompt to ChatGPT and exit without reading the response')
    .argument('[prompt]', 'prompt instruction; piped stdin may be combined with it')
    .option('-p, --project <alias>', 'configured ChatGPT Project alias')
    .option('--host <host>', 'Firefox remote debugging host')
    .option('--port <port>', 'Firefox WebDriver BiDi port')
    .option('--timeout <ms>', 'global operation timeout in milliseconds')
    .option('--verbose', 'enable sanitized diagnostic logging')
    .action(async (prompt: string | undefined, options: AskCommandOptions) => {
      await (handlers.ask ?? runAsk)(prompt, options);
    });

  program
    .command('doctor')
    .description('check Firefox, WebDriver BiDi, ChatGPT, and project readiness')
    .option('--host <host>', 'Firefox remote debugging host')
    .option('--port <port>', 'Firefox WebDriver BiDi port')
    .option('--timeout <ms>', 'global operation timeout in milliseconds')
    .option('--verbose', 'enable sanitized diagnostic logging')
    .action(async (options: DoctorCommandOptions) => {
      await (handlers.doctor ?? runDoctor)(options);
    });

  return program;
}

export async function runCli(
  argv: readonly string[] = process.argv,
  handlers: CliHandlers = {},
): Promise<number> {
  const program = createProgram(handlers);
  try {
    await program.parseAsync([...argv], { from: 'node' });
    return 0;
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      return error.code === 'commander.helpDisplayed' || error.code === 'commander.version'
        ? EXIT_CODES.success
        : EXIT_CODES.usage;
    }
    throw error;
  }
}

if (isCliEntrypoint()) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(formatError(error, { verbose: process.argv.includes('--verbose') }));
      process.exitCode = formatExitCode(error);
    });
}

function formatExitCode(error: unknown): number {
  return toFfgptError(error).exitCode;
}

function isCliEntrypoint(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
