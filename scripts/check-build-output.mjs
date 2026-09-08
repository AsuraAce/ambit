import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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
const html = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8');
const entryAsset = html.match(/<script\b[^>]*type="module"[^>]*src="\/assets\/([^"/]+\.js)"/i)?.[1];
if (!entryAsset || !html.includes('src="/startup-bootstrap.js"')) {
  throw new Error('Build output guard failed: independent startup entries are missing.');
}

// Vite merges multiple HTML module tags. Inspect its emitted static import
// closure, not source-tag order, so diagnostics can run when the app chunk fails.
const diagnosticClosure = new Set();
const pendingImports = [join(assetsDir, entryAsset)];
let diagnosticBytes = 0;
let hasDeferredApplication = false;
while (pendingImports.length) {
  const file = pendingImports.pop();
  if (diagnosticClosure.has(file)) continue;
  if (!file.startsWith(`${assetsDir}${sep}`)) {
    throw new Error('Build output guard failed: unexpected startup import location.');
  }
  diagnosticClosure.add(file);
  const code = readFileSync(file, 'utf8');
  diagnosticBytes += statSync(file).size;
  for (const match of code.matchAll(/\bimport\(["'`]\.\/([^"'`]+\.js)["'`]\)/g)) {
    const deferred = resolve(dirname(file), match[1]);
    if (deferred.startsWith(`${assetsDir}${sep}`) && readFileSync(deferred, 'utf8').includes('createRoot(')) {
      hasDeferredApplication = true;
    }
  }
  for (const match of code.matchAll(/\bimport\s*(?:[^;()]*?\bfrom\s*)?["']([^"']+)["']/g)) {
    if (!match[1].startsWith('./') || !match[1].endsWith('.js')) {
      throw new Error('Build output guard failed: unexpected static startup import.');
    }
    pendingImports.push(resolve(dirname(file), match[1]));
  }
}
if (!hasDeferredApplication || diagnosticBytes > 96 * 1024 ||
    [...diagnosticClosure].some(file => /[\\/](?:react-runtime|app-runtime|ui-icons)-/.test(file))) {
  throw new Error('Build output guard failed: diagnostic transport is coupled to the application module graph.');
}

const startupChunks = readdirSync(assetsDir)
  .filter(file => /^(?:index|src)-[\w-]+\.js$/.test(file))
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
  `Build output guard passed: ${largestStartupChunk.file} is ${Math.round(largestStartupChunk.size / 1024)} kB; independent diagnostic closure is ${Math.round(diagnosticBytes / 1024)} kB; no ineffective dynamic imports were reported.`
);
