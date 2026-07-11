import assert from 'node:assert/strict';
import test from 'node:test';

import { extractReleaseNotes } from './extract-release-notes.mjs';

const changelog = `# Changelog

## [0.8.0](https://github.com/AsuraAce/ambit/compare/v0.7.0...v0.8.0) (2026-07-11)

### Features

* show useful update notes

### Bug Fixes

* preserve the installer flow

## [0.7.0](https://github.com/AsuraAce/ambit/compare/v0.6.4...v0.7.0) (2026-07-10)

### Features

* older change
`;

test('extracts only the requested release section for updater metadata', () => {
  assert.equal(
    extractReleaseNotes(changelog, 'v0.8.0'),
    `### Features

* show useful update notes

### Bug Fixes

* preserve the installer flow`,
  );
});

test('accepts a version without the tag prefix', () => {
  assert.match(extractReleaseNotes(changelog, '0.7.0'), /older change/);
});

test('rejects missing and malformed release versions', () => {
  assert.throws(() => extractReleaseNotes(changelog, 'v0.9.0'), /Could not find release 0\.9\.0/);
  assert.throws(() => extractReleaseNotes(changelog, 'latest'), /must use X\.Y\.Z or vX\.Y\.Z/);
});
