import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const STARTUP_CHUNK_LIMIT_BYTES = 500 * 1024;
const isWindows = process.platform === 'win32';

const result = isWindows ? spawnSync('pnpm exec vite build', {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: true,
}) : spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
if (combinedOutput.includes('INEFFECTIVE_DYNAMIC_IMPORT')) {
  console.error('Build output guard failed: ineffective dynamic imports returned.');
  process.exit(1);
}

const assetsDir = join(process.cwd(), 'dist', 'assets');
const startupChunks = readdirSync(assetsDir)
  .filter(file => /^index-[\w-]+\.js$/.test(file))
  .map(file => {
    const path = join(assetsDir, file);
    return { file, size: statSync(path).size };
  });

if (startupChunks.length === 0) {
  console.error('Build output guard failed: no startup index chunk found in dist/assets.');
  process.exit(1);
}

const largestStartupChunk = startupChunks.reduce((largest, current) =>
  current.size > largest.size ? current : largest
);

if (largestStartupChunk.size > STARTUP_CHUNK_LIMIT_BYTES) {
  console.error(
    `Build output guard failed: ${largestStartupChunk.file} is ${Math.round(largestStartupChunk.size / 1024)} kB, above the 500 kB startup limit.`
  );
  process.exit(1);
}

console.log(
  `Build output guard passed: ${largestStartupChunk.file} is ${Math.round(largestStartupChunk.size / 1024)} kB and no ineffective dynamic imports were reported.`
);
