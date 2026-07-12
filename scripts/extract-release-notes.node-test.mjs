import assert from 'node:assert/strict';
import test from 'node:test';

import {
  METADATA_REFRESH_NOTICE,
  addMetadataRefreshNotice,
  buildUpdaterReleaseNotes,
  extractPreviousReleaseTag,
  extractReleaseNotes,
  parseParserVersion,
} from './extract-release-notes.mjs';

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

test('extracts the previous stable release from the comparison link', () => {
  assert.equal(extractPreviousReleaseTag(changelog, 'v0.8.0'), 'v0.7.0');
});

test('prepends the metadata refresh notice exactly once when the parser version increases', () => {
  const notesWithNotice = buildUpdaterReleaseNotes({
    changelog,
    versionOrTag: 'v0.8.0',
    previousParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 13;',
    currentParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 17;',
  });

  assert.ok(notesWithNotice.startsWith(`${METADATA_REFRESH_NOTICE}\n\n### Features`));
  assert.equal(notesWithNotice.match(/### Before you update/g)?.length, 1);
  assert.doesNotMatch(notesWithNotice, /older change/);

  assert.equal(
    addMetadataRefreshNotice({
      notes: notesWithNotice,
      previousParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 13;',
      currentParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 17;',
    }),
    notesWithNotice,
  );
});

test('preserves release notes when the parser version is unchanged', () => {
  const notes = extractReleaseNotes(changelog, 'v0.8.0');

  assert.equal(
    addMetadataRefreshNotice({
      notes,
      previousParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 17;',
      currentParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 17;',
    }),
    notes,
  );
});

test('rejects missing or malformed parser version constants', () => {
  assert.throws(
    () => parseParserVersion('pub const SOMETHING_ELSE: u32 = 17;', 'test parser source'),
    /Could not find CURRENT_PARSER_VERSION in test parser source/,
  );
  assert.throws(
    () => parseParserVersion('pub const CURRENT_PARSER_VERSION: usize = 17;', 'test parser source'),
    /Could not find CURRENT_PARSER_VERSION in test parser source/,
  );
});

test('rejects parser version regressions', () => {
  assert.throws(
    () => addMetadataRefreshNotice({
      notes: 'Existing notes',
      previousParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 17;',
      currentParserSource: 'pub const CURRENT_PARSER_VERSION: u32 = 16;',
    }),
    /CURRENT_PARSER_VERSION decreased from 17 to 16/,
  );
});

test('rejects missing and malformed release versions', () => {
  assert.throws(() => extractReleaseNotes(changelog, 'v0.9.0'), /Could not find release 0\.9\.0/);
  assert.throws(() => extractReleaseNotes(changelog, 'latest'), /must use X\.Y\.Z or vX\.Y\.Z/);
});
