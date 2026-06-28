import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateReleaseTag } from './check-release-tag.mjs';

const makeProject = (t, versions = {}) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambit-release-tag-'));
  const version = versions.packageVersion ?? '0.6.3';

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

  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  return rootDir;
};

const makeEnv = (tagName) => ({
  GITHUB_REF_TYPE: 'tag',
  GITHUB_REF_NAME: tagName,
  GITHUB_REF: `refs/tags/${tagName}`,
});

const makeGit = ({ headCommit = 'abc123', tagCommit = 'abc123', hasOriginMain = true, reachableFromMain = true } = {}) => ({
  text(args) {
    if (args.join(' ') === 'rev-parse HEAD') {
      return headCommit;
    }

    if (args[0] === 'rev-list' && args[1] === '-n' && args[2] === '1') {
      return tagCommit;
    }

    throw new Error(`Unexpected git text call: ${args.join(' ')}`);
  },
  succeeds(args) {
    if (args.join(' ') === 'rev-parse --verify refs/remotes/origin/main^{commit}') {
      return hasOriginMain;
    }

    if (args.join(' ') === `merge-base --is-ancestor ${tagCommit} refs/remotes/origin/main`) {
      return reachableFromMain;
    }

    throw new Error(`Unexpected git succeeds call: ${args.join(' ')}`);
  },
});

test('accepts a Release Please version tag when files and git provenance match', (t) => {
  const rootDir = makeProject(t);

  const result = validateReleaseTag({
    env: makeEnv('v0.6.3'),
    rootDir,
    git: makeGit(),
  });

  assert.deepEqual(result, {
    tagName: 'v0.6.3',
    version: '0.6.3',
    commit: 'abc123',
  });
});

test('rejects legacy ambit-prefixed release tags', (t) => {
  const rootDir = makeProject(t);

  assert.throws(
    () =>
      validateReleaseTag({
        env: makeEnv('ambit-v0.6.3'),
        rootDir,
        git: makeGit(),
      }),
    /exact vX\.Y\.Z format/,
  );
});

test('rejects malformed release tags', (t) => {
  const rootDir = makeProject(t);

  for (const tagName of ['v0.6', 'v0.6.3-hotfix', 'release-0.6.3']) {
    assert.throws(
      () =>
        validateReleaseTag({
          env: makeEnv(tagName),
          rootDir,
          git: makeGit(),
        }),
      /exact vX\.Y\.Z format/,
      `${tagName} should not be accepted`,
    );
  }
});

test('rejects version mismatches between the tag and repository files', (t) => {
  const rootDir = makeProject(t, { tauriVersion: '0.6.2' });

  assert.throws(
    () =>
      validateReleaseTag({
        env: makeEnv('v0.6.3'),
        rootDir,
        git: makeGit(),
      }),
    /does not match repository version files[\s\S]*src-tauri\/tauri\.conf\.json: 0\.6\.2/,
  );
});

test('rejects a checkout that is not the tag target commit', (t) => {
  const rootDir = makeProject(t);

  assert.throws(
    () =>
      validateReleaseTag({
        env: makeEnv('v0.6.3'),
        rootDir,
        git: makeGit({ headCommit: 'checked-out', tagCommit: 'tag-target' }),
      }),
    /does not match tag v0\.6\.3 target tag-target/,
  );
});

test('rejects a tag target that is not reachable from origin/main', (t) => {
  const rootDir = makeProject(t);

  assert.throws(
    () =>
      validateReleaseTag({
        env: makeEnv('v0.6.3'),
        rootDir,
        git: makeGit({ reachableFromMain: false }),
      }),
    /not reachable from origin\/main/,
  );
});
