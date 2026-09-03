import { pathToFileURL } from 'node:url';
import process from 'node:process';

import { readRepositoryVersions } from './version-files.mjs';

export const validateVersionConsistency = ({ rootDir = process.cwd() } = {}) => {
  const versions = readRepositoryVersions(rootDir);
  const packageVersion = versions.find(({ path }) => path === 'package.json')?.version;
  const mismatches = versions.filter(({ version }) => version !== packageVersion);

  if (mismatches.length > 0) {
    const details = mismatches.map(({ path, version }) => `${path}: ${version}`).join('\n');
    throw new Error(
      `Version mismatch detected. Expected all versions to match package.json.\n` +
        `package.json: ${packageVersion}\n${details}`,
    );
  }

  return packageVersion;
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    const version = validateVersionConsistency();
    console.log(`Version check passed: ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
