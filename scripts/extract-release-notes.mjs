import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^v?(\d+\.\d+\.\d+)$/;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const extractReleaseNotes = (changelog, versionOrTag) => {
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

  const afterHeading = changelog.slice(headingMatch.index + headingMatch[0].length);
  const nextReleaseIndex = afterHeading.search(/^## \[/m);
  const notes = afterHeading.slice(0, nextReleaseIndex === -1 ? undefined : nextReleaseIndex).trim();

  if (!notes) {
    throw new Error(`Release ${version} has no notes in CHANGELOG.md.`);
  }

  return notes;
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    const versionOrTag = process.argv[2];

    if (!versionOrTag) {
      throw new Error('Usage: node scripts/extract-release-notes.mjs <version-or-tag>');
    }

    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
    const notes = extractReleaseNotes(fs.readFileSync(changelogPath, 'utf8'), versionOrTag);
    console.log(notes);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
