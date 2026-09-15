export interface AskCommandOptions {
  project?: string;
  host?: string;
  port?: string;
  timeout?: string;
  verbose?: boolean;
}

export async function runAsk(
  prompt: string | undefined,
  options: AskCommandOptions,
): Promise<void> {
  void prompt;
  void options;
  throw new Error('The ask command is not implemented yet.');
}
