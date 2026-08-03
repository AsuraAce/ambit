import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateVersionConsistency } from './check-version-consistency.mjs';

const makeProject = (t, versions = {}) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambit-version-consistency-'));
  const version = versions.packageVersion ?? '0.6.3';

  fs.mkdirSync(path.join(rootDir, '.github'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ version }, null, 2));
  fs.writeFileSync(
    path.join(rootDir, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ version: versions.tauriVersion ?? version }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, 'src-tauri', 'tauri.dev.json'),
    JSON.stringify({ version: versions.tauriDevVersion ?? version }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, 'src-tauri', 'Cargo.toml'),
    `[package]\nname = "app"\nversion = "${versions.cargoVersion ?? version}"\n`,
  );
  fs.writeFileSync(
    path.join(rootDir, 'src-tauri', 'Cargo.lock'),
    versions.cargoLockContents ??
      `version = 4\n\n[[package]]\nname = "app"\nversion = "${versions.cargoLockVersion ?? version}"\n`,
  );
  fs.writeFileSync(
    path.join(rootDir, '.github', '.release-please-manifest.json'),
    JSON.stringify({ '.': versions.releaseManifestVersion ?? version }, null, 2),
  );

  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  return rootDir;
};

test('accepts a repository when every release version source agrees', (t) => {
  const rootDir = makeProject(t);

  assert.equal(validateVersionConsistency({ rootDir }), '0.6.3');
});

test('rejects a stale Cargo lock package version', (t) => {
  const rootDir = makeProject(t, { cargoLockVersion: '0.6.2' });

  assert.throws(
    () => validateVersionConsistency({ rootDir }),
    /Version mismatch detected[\s\S]*src-tauri\/Cargo\.lock: 0\.6\.2/,
  );
});

test('rejects a stale Release Please manifest version', (t) => {
  const rootDir = makeProject(t, { releaseManifestVersion: '0.6.2' });

  assert.throws(
    () => validateVersionConsistency({ rootDir }),
    /Version mismatch detected[\s\S]*\.github\/\.release-please-manifest\.json: 0\.6\.2/,
  );
});

test('rejects a Cargo lockfile without exactly one local app package', (t) => {
  const rootDir = makeProject(t, {
    cargoLockContents: 'version = 4\n\n[[package]]\nname = "dependency"\nversion = "1.0.0"\n',
  });

  assert.throws(
    () => validateVersionConsistency({ rootDir }),
    /Expected exactly one app package in src-tauri\/Cargo\.lock, found 0/,
  );
});
