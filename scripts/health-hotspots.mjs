// Lists the largest and most branch-heavy source files in src/ and src-tauri/src/.
// Part of `pnpm health`: a report for milestone reviews, never a gate.
// The branch count is a rough cyclomatic-complexity proxy (decision keywords and
// short-circuit operators, comments and strings not stripped), good enough to rank
// hot spots, not to compare with a real complexity metric.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

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

function testModuleStart(text) {
  // Rust unit tests live in `#[cfg(test)] mod tests` blocks at the end of the file.
  const index = text.search(/#\[cfg\(test\)\]\s*mod\s+\w+\s*\{/);
  return index === -1 ? text.length : index;
}

for (const { dir, exts } of ROOTS) {
  const rows = walk(dir, exts, [])
    .map((path) => relative('.', path))
    .filter((path) => !SKIP.some((pattern) => pattern.test(path)))
    .map((path) => {
      const full = readFileSync(path, 'utf8');
      const text = full.slice(0, testModuleStart(full));
      return {
        path: path.replaceAll('\\', '/'),
        lines: text.split('\n').length,
        branches: (text.match(BRANCH) ?? []).length,
      };
    });

  const totalLines = rows.reduce((sum, row) => sum + row.lines, 0);
  console.log(`\n## ${dir}: ${rows.length} files, ${totalLines} lines (tests excluded)`);
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
