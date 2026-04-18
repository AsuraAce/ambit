import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

const readJson = (relativePath) => {
  const absolutePath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

const readCargoVersion = (relativePath) => {
  const absolutePath = path.join(rootDir, relativePath);
  const cargoToml = fs.readFileSync(absolutePath, 'utf8');
  const versionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"$/m);

  if (!versionMatch) {
    throw new Error(`Could not find Cargo version in ${relativePath}`);
  }

  return versionMatch[1];
};

const packageVersion = readJson('package.json').version;
const tauriVersion = readJson('src-tauri/tauri.conf.json').version;
const tauriDevVersion = readJson('src-tauri/tauri.dev.json').version;
const cargoVersion = readCargoVersion('src-tauri/Cargo.toml');

const mismatches = [
  ['package.json', packageVersion],
  ['src-tauri/tauri.conf.json', tauriVersion],
  ['src-tauri/tauri.dev.json', tauriDevVersion],
  ['src-tauri/Cargo.toml', cargoVersion],
].filter(([, version]) => version !== packageVersion);

if (mismatches.length > 0) {
  console.error('Version mismatch detected. Expected all versions to match package.json.');
  console.error(`package.json: ${packageVersion}`);

  for (const [relativePath, version] of mismatches) {
    console.error(`${relativePath}: ${version}`);
  }

  process.exit(1);
}

console.log(`Version check passed: ${packageVersion}`);
