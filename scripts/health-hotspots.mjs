// Lists the largest and most branch-heavy source files in src/ and src-tauri/src/.
// Part of `pnpm health`: a report for milestone reviews, never a gate.
// The branch count is a rough cyclomatic-complexity proxy (decision keywords and
// short-circuit operators, comments and strings not stripped), good enough to rank
// hot spots, not to compare with a real complexity metric.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOTS = [
    { dir: 'src', exts: ['.ts', '.tsx'] },
    { dir: 'src-tauri/src', exts: ['.rs'] },
];
const SKIP = [/[\\/]__tests__[\\/]/, /\.test\.tsx?$/, /^src[\\/]test[\\/]/, /^src[\\/]bindings\.ts$/, /[\\/_]tests?(\.rs|[\\/])/];
const BRANCH = /\b(if|for|while|case|catch|match)\b|&&|\|\||\?\?/g;
const TOP = Number(process.argv[2] ?? 15);

function walk(dir, exts, out) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, exts, out);
        else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(path);
    }
    return out;
}

// Removes Rust `#[cfg(test)] mod name { ... }` blocks wherever they sit in the file,
// by matching braces. Braces inside strings or char literals are not special-cased;
// a miscount only shifts one file's figures in this report.
export function stripRustTestModules(text) {
    const opener = /#\[cfg\(test\)\]\s*mod\s+\w+\s*\{/g;
    let out = '';
    let from = 0;
    let match;
    while ((match = opener.exec(text)) !== null) {
        let depth = 1;
        let index = match.index + match[0].length;
        while (index < text.length && depth > 0) {
            if (text[index] === '{') depth += 1;
            else if (text[index] === '}') depth -= 1;
            index += 1;
        }
        out += text.slice(from, match.index);
        from = index;
        opener.lastIndex = index;
    }
    return out + text.slice(from);
}

function report() {
    for (const { dir, exts } of ROOTS) {
        const rows = walk(dir, exts, [])
            .map((path) => relative('.', path))
            .filter((path) => !SKIP.some((pattern) => pattern.test(path)))
            .map((path) => {
                const full = readFileSync(path, 'utf8');
                const text = path.endsWith('.rs') ? stripRustTestModules(full) : full;
                return {
                    path: path.replaceAll('\\', '/'),
                    lines: text.split('\n').length,
                    branches: (text.match(BRANCH) ?? []).length,
                };
            });

        const totalLines = rows.reduce((sum, row) => sum + row.lines, 0);
        console.log(`\n## ${dir}: ${rows.length} files, ${totalLines} lines (test files and inline test modules excluded)`);
        for (const [label, key] of [
            ['Largest files (lines)', 'lines'],
            ['Most branches', 'branches'],
        ]) {
            console.log(`\n${label}:`);
            for (const row of [...rows].sort((a, b) => b[key] - a[key]).slice(0, TOP)) {
                console.log(`  ${String(row[key]).padStart(6)}  ${row.path}`);
            }
        }
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) report();
