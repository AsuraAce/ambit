import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Library/bin compilation still expands generate_context!, which needs Tauri's
// generated capability manifest even though this command never launches the app.
const env = { ...process.env };
delete env.SKIP_TAURI_BUILD;

const result = spawnSync('cargo', ['test', '--lib', '--bins'], {
  cwd: fileURLToPath(new URL('../src-tauri/', import.meta.url)),
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
