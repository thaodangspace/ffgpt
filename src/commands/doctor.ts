export interface DoctorCommandOptions {
  host?: string;
  port?: string;
  timeout?: string;
  verbose?: boolean;
}

export async function runDoctor(options: DoctorCommandOptions): Promise<void> {
  void options;
  throw new Error('The doctor command is not implemented yet.');
}
