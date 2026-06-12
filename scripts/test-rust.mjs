import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync('cargo', ['test', '--lib'], {
  cwd: fileURLToPath(new URL('../src-tauri/', import.meta.url)),
  env: {
    ...process.env,
    SKIP_TAURI_BUILD: '1',
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
