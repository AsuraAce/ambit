import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const expectedPath = path.join(rootDir, 'src', 'bindings.ts');
const generatedPath = path.join(rootDir, 'src-tauri', 'target', 'bindings.check.ts');
const generatedArg = path.relative(rootDir, generatedPath);

fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
fs.rmSync(generatedPath, { force: true });

const result = spawnSync(
  'cargo',
  [
    'run',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--bin',
    'export_bindings',
    '--',
    generatedArg,
  ],
  { cwd: rootDir, stdio: 'inherit' },
);

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}

const normalize = (value) => value.replace(/\r\n/g, '\n');
const expected = normalize(fs.readFileSync(expectedPath, 'utf8'));
const generated = normalize(fs.readFileSync(generatedPath, 'utf8'));

fs.rmSync(generatedPath, { force: true });

if (expected !== generated) {
  console.error('src/bindings.ts is out of date.');
  console.error('Run `pnpm run bindings:generate` and commit the updated file.');
  process.exit(1);
}

console.log('Binding check passed.');
