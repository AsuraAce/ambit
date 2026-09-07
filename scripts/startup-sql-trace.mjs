// Explicit owner command only. No database inspection, profile creation or settings changes.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function treeHash(directory) {
    const digest = createHash('sha256');
    function visit(current, prefix) {
        for (const item of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const relative = `${prefix}${item.name}`;
            if (item.isSymbolicLink()) throw new Error('Redirected diagnostic source rejected');
            if (item.isDirectory()) visit(join(current, item.name), `${relative}/`);
            else if (item.isFile()) digest.update(relative).update('\0').update(readFileSync(join(current, item.name)));
        }
    }
    visit(directory, '');
    return digest.digest('hex');
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (revision.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(revision.stdout)) throw new Error('Diagnostic revision unavailable');
const buildId = randomUUID();
const sources = {
    collection: 'src/services/db/collectionRepo.ts',
    maintenance: 'src/services/db/maintenanceRepo.ts',
    gallery: 'src/services/db/searchRepo.ts',
    frontendTrace: 'src/utils/startupSqlTrace.ts',
    bridge: 'src/utils/startupDiagnostics.ts',
    nativeTrace: 'src-tauri/src/startup_sql_trace.rs',
    journal: 'src-tauri/src/startup_log.rs',
    nativeStartup: 'src-tauri/src/startup.rs',
    nativeEntry: 'src-tauri/src/lib.rs',
    cargoManifest: 'src-tauri/Cargo.toml',
    cargoLock: 'src-tauri/Cargo.lock',
};
const sourceHashes = Object.fromEntries(Object.entries(sources).map(([label, path]) => [label, hash(readFileSync(resolve(root, path)))]));
const manifest = { schema: 1, buildId, revision: revision.stdout.trim(), pluginVersion: '2.4.0', sourceHashes,
    vendorHash: treeHash(resolve(root, 'src-tauri/vendor/tauri-plugin-sql')),
    boundary: 'source manifest before compilation; no library reads; not proof of successful build or startup' };
const target = resolve(root, 'src-tauri/target');
mkdirSync(target, { recursive: true });
writeFileSync(join(target, `startup-sql-build-${buildId}.json`), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.info(`[Startup SQL diagnostics] build=${buildId}; regular dev only; tracing is not a performance fix.`);
if (process.argv.includes('--prepare-only')) process.exit(0);
const cli = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js');
const result = spawnSync(process.execPath, [cli, 'dev', '--config', 'src-tauri/tauri.dev.json', '--features', 'startup-sql-trace'], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, AMBIT_SQL_TRACE_BUILD_ID: buildId },
});
process.exit(result.status ?? 1);
