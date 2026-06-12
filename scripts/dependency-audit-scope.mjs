import fs from 'node:fs';
import process from 'node:process';

const runAll = process.argv.includes('--all');
const filesArgumentIndex = process.argv.indexOf('--files');
const changedFiles = runAll
  ? []
  : filesArgumentIndex >= 0
    ? process.argv.slice(filesArgumentIndex + 1)
    : fs.readFileSync(0).toString('utf8').split('\0').filter(Boolean);

const npmChanged = changedFiles.some((file) =>
  ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(file),
);
const rustChanged = changedFiles.some((file) =>
  ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'scripts/audit-rust.mjs'].includes(file),
);
const workflowChanged = changedFiles.some(
  (file) =>
    file === '.github/dependabot.yml' ||
    file === 'scripts/dependency-audit-scope.mjs' ||
    file.startsWith('.github/workflows/'),
);

const runNpm = runAll || npmChanged || workflowChanged;
const runRust = runAll || rustChanged || workflowChanged;

console.log(`run_npm=${runNpm}`);
console.log(`run_rust=${runRust}`);
console.log(`workflow_changed=${runAll || workflowChanged}`);
