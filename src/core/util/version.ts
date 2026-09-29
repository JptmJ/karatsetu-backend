import { hostname } from 'node:os';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let cachedVersion = '';

export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    cachedVersion = pkg.version || '0.1.0';
  } catch {
    cachedVersion = '0.1.0';
  }
  return cachedVersion;
}

export function buildStamp(version: string = getPackageVersion()): string {
  let sha = process.env.GIT_SHA ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'nogit';
    }
  }
  return `${version}+${sha}@${hostname()}`;
}
