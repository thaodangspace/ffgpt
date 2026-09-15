import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'ffgpt-pack-smoke-'));
const tarballDirectory = path.join(temporaryDirectory, 'tarball');
const installDirectory = path.join(temporaryDirectory, 'install');
mkdirSync(tarballDirectory);
mkdirSync(installDirectory);

try {
  execFileSync('pnpm', ['build'], { stdio: 'inherit' });
  execFileSync('pnpm', ['pack', '--pack-destination', tarballDirectory, '--silent'], {
    stdio: 'inherit',
  });
  const tarball = path.join(tarballDirectory, `ffgpt-${packageJson.version}.tgz`);
  execFileSync('npm', ['init', '-y'], { cwd: installDirectory, stdio: 'ignore' });
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
    cwd: installDirectory,
    stdio: 'inherit',
  });

  const binary = path.join(installDirectory, 'node_modules', '.bin', 'ffgpt');
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  if (version !== packageJson.version) {
    throw new Error(`Expected ffgpt ${packageJson.version}, got ${version}`);
  }
  execFileSync(binary, ['--help'], { stdio: 'inherit' });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
