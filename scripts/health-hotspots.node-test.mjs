import assert from 'node:assert/strict';
import test from 'node:test';
import { stripRustTestModules } from './health-hotspots.mjs';

// Ambit keeps production functions after inline test modules (src-tauri/src/lib.rs),
// so the size report must strip the module, not cut the file at it.
test('keeps production code that follows a mid-file test module', () => {
    const source = [
        'fn before() {}',
        '#[cfg(test)]',
        'mod tests {',
        '    fn helper() { if true { let _ = 1; } }',
        '}',
        'pub fn after() { if ready { run(); } }',
    ].join('\n');

    const stripped = stripRustTestModules(source);

    assert.match(stripped, /fn before/);
    assert.match(stripped, /pub fn after/);
    assert.doesNotMatch(stripped, /helper/);
});

test('strips every test module and leaves files without one unchanged', () => {
    const source = 'fn a() {}\n#[cfg(test)] mod one { }\nfn b() {}\n#[cfg(test)]\nmod two { fn x() {} }\n';
    assert.equal(stripRustTestModules(source), 'fn a() {}\n\nfn b() {}\n\n');
    assert.equal(stripRustTestModules('fn only() {}'), 'fn only() {}');
});
