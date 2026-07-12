import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^v?(\d+\.\d+\.\d+)$/;
const PARSER_SOURCE_PATH = 'src-tauri/src/metadata/mod.rs';
const PARSER_VERSION_RE = /^\s*pub const CURRENT_PARSER_VERSION:\s*u32\s*=\s*(\d+);\s*$/m;

export const METADATA_REFRESH_NOTICE = `### Before you update

**Metadata refresh:** When Ambit starts after the update, it will re-analyze metadata for affected existing images in the background. Large libraries may take some time; you can keep browsing while the refresh runs.`;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findRelease = (changelog, versionOrTag) => {
  const versionMatch = versionOrTag.match(VERSION_RE);

  if (!versionMatch) {
    throw new Error(`Release version must use X.Y.Z or vX.Y.Z format. Received: ${versionOrTag}`);
  }

  const version = versionMatch[1];
  const headingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\](?:\\([^\\n]+\\))?(?: \\([^\\n]+\\))?\\s*$`,
    'm',
  );
  const headingMatch = headingPattern.exec(changelog);

  if (!headingMatch) {
    throw new Error(`Could not find release ${version} in CHANGELOG.md.`);
  }

  return { version, headingMatch };
};

export const extractReleaseNotes = (changelog, versionOrTag) => {
  const { headingMatch } = findRelease(changelog, versionOrTag);

  const afterHeading = changelog.slice(headingMatch.index + headingMatch[0].length);
  const nextReleaseIndex = afterHeading.search(/^## \[/m);
  const notes = afterHeading.slice(0, nextReleaseIndex === -1 ? undefined : nextReleaseIndex).trim();

  if (!notes) {
    throw new Error(`Release ${version} has no notes in CHANGELOG.md.`);
  }

  return notes;
};

export const extractPreviousReleaseTag = (changelog, versionOrTag) => {
  const { version, headingMatch } = findRelease(changelog, versionOrTag);
  const compareMatch = headingMatch[0].match(/\/compare\/(v\d+\.\d+\.\d+)\.\.\.(v\d+\.\d+\.\d+)\)/);

  if (!compareMatch) {
    throw new Error(`Release ${version} must include a stable GitHub comparison link.`);
  }

  const [, previousTag, targetTag] = compareMatch;
  const expectedTargetTag = `v${version}`;

  if (targetTag !== expectedTargetTag) {
    throw new Error(`Release ${version} comparison link targets ${targetTag}, expected ${expectedTargetTag}.`);
  }

  return previousTag;
};

export const parseParserVersion = (source, label) => {
  const versionMatch = source.match(PARSER_VERSION_RE);

  if (!versionMatch) {
    throw new Error(`Could not find CURRENT_PARSER_VERSION in ${label}.`);
  }

  return Number(versionMatch[1]);
};

export const addMetadataRefreshNotice = ({ notes, previousParserSource, currentParserSource }) => {
  const previousVersion = parseParserVersion(previousParserSource, 'previous release parser source');
  const currentVersion = parseParserVersion(currentParserSource, 'current release parser source');

  if (currentVersion < previousVersion) {
    throw new Error(`CURRENT_PARSER_VERSION decreased from ${previousVersion} to ${currentVersion}.`);
  }

  if (currentVersion === previousVersion || notes.includes(METADATA_REFRESH_NOTICE)) {
    return notes;
  }

  return `${METADATA_REFRESH_NOTICE}\n\n${notes}`;
};

export const buildUpdaterReleaseNotes = ({
  changelog,
  versionOrTag,
  previousParserSource,
  currentParserSource,
}) => addMetadataRefreshNotice({
  notes: extractReleaseNotes(changelog, versionOrTag),
  previousParserSource,
  currentParserSource,
});

const readPreviousParserSource = (rootDir, previousTag) => {
  try {
    return execFileSync('git', ['show', `${previousTag}:${PARSER_SOURCE_PATH}`], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`Could not read ${PARSER_SOURCE_PATH} from ${previousTag}.`);
  }
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    const versionOrTag = process.argv[2];

    if (!versionOrTag) {
      throw new Error('Usage: node scripts/extract-release-notes.mjs <version-or-tag>');
    }

    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    const previousTag = extractPreviousReleaseTag(changelog, versionOrTag);
    const currentParserSource = fs.readFileSync(path.join(process.cwd(), PARSER_SOURCE_PATH), 'utf8');
    const previousParserSource = readPreviousParserSource(process.cwd(), previousTag);
    const notes = buildUpdaterReleaseNotes({
      changelog,
      versionOrTag,
      previousParserSource,
      currentParserSource,
    });
    console.log(notes);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
