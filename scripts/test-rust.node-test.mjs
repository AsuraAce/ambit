import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('Rust runner generates Tauri capabilities even when the parent skips build setup', () => {
  const preload = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = (command, args, options) => {
      console.log(JSON.stringify({ command, args, skip: options.env.SKIP_TAURI_BUILD ?? null }));
      return { status: 0 };
    };
    syncBuiltinESMExports();
  `;
  const result = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('./test-rust.mjs', import.meta.url)),
  ], {
    env: { ...process.env, SKIP_TAURI_BUILD: '1' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    command: 'cargo', args: ['test', '--lib', '--bins'], skip: null,
  });
});
