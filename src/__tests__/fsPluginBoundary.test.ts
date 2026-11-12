import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

// #415: the webview's fs plugin may reach only AppLocalData (through the capability)
// and paths the user picked in a save or export dialog. Library folders are read
// and checked through Rust commands that consult the grant registry. A new import
// of the plugin is a new way to touch the filesystem, so it needs a reason here.
const ALLOWED = new Map([
    ['services/TauriFsRepository.ts', 'settings and library files in AppLocalData'],
    ['services/thumbnailService.ts', "Ambit's thumbnails in AppLocalData"],
    ['utils/invokeSyncTrace.ts', 'sync traces in AppLocalData'],
    ['services/exportService.ts', 'the ZIP written to the dialog-picked export folder'],
    ['features/viewer/components/WorkflowInspector.tsx', 'workflow JSON written to the save-dialog path'],
]);

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'test' ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });

describe('fs plugin boundary', () => {
    it('lets only the allow-listed modules import the fs plugin', () => {
        const importers = sourceFiles(SRC)
            .filter((file) => readFileSync(file, 'utf8').includes('@tauri-apps/plugin-fs'))
            .map((file) => relative(SRC, file).replace(/\\/g, '/'))
            .sort();

        expect(importers).toEqual([...ALLOWED.keys()].sort());
    });
});
