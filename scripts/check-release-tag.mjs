import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const RELEASE_TAG_RE = /^v(\d+\.\d+\.\d+)$/;

const VERSION_FILES = [
  {
    path: 'package.json',
    readVersion: (contents) => JSON.parse(contents).version,
  },
  {
    path: 'src-tauri/tauri.conf.json',
    readVersion: (contents) => JSON.parse(contents).version,
  },
  {
    path: 'src-tauri/tauri.dev.json',
    readVersion: (contents) => JSON.parse(contents).version,
  },
  {
    path: 'src-tauri/Cargo.toml',
    readVersion: (contents) => {
      const versionMatch = contents.match(/^version\s*=\s*"([^"]+)"$/m);

      if (!versionMatch) {
        throw new Error('Could not find Cargo package version.');
      }

      return versionMatch[1];
    },
  },
];

const readVersions = (rootDir) =>
  VERSION_FILES.map((versionFile) => {
    const absolutePath = path.join(rootDir, versionFile.path);
    const contents = fs.readFileSync(absolutePath, 'utf8');

    return {
      path: versionFile.path,
      version: versionFile.readVersion(contents),
    };
  });

export const createGit = (rootDir) => ({
  text(args) {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  },
  succeeds(args) {
    const result = spawnSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return result.status === 0;
  },
});

const assertGitHubTagPush = (env) => {
  if (env.GITHUB_REF_TYPE !== 'tag') {
    throw new Error(`Release workflow must run from a tag push. GITHUB_REF_TYPE=${env.GITHUB_REF_TYPE ?? '<unset>'}`);
  }

  if (!env.GITHUB_REF_NAME) {
    throw new Error('Release workflow must provide GITHUB_REF_NAME for the pushed tag.');
  }

  if (env.GITHUB_REF && env.GITHUB_REF !== `refs/tags/${env.GITHUB_REF_NAME}`) {
    throw new Error(`Release workflow ref ${env.GITHUB_REF} does not match tag ${env.GITHUB_REF_NAME}.`);
  }
};

const parseReleaseTag = (tagName) => {
  const match = tagName.match(RELEASE_TAG_RE);

  if (!match) {
    throw new Error(`Release tag must use the exact vX.Y.Z format. Received: ${tagName}`);
  }

  return match[1];
};

export const validateReleaseTag = ({ env = process.env, rootDir = process.cwd(), git = createGit(rootDir) } = {}) => {
  assertGitHubTagPush(env);

  const tagName = env.GITHUB_REF_NAME;
  const tagVersion = parseReleaseTag(tagName);
  const versions = readVersions(rootDir);
  const mismatches = versions.filter(({ version }) => version !== tagVersion);

  if (mismatches.length > 0) {
    const details = mismatches.map(({ path: versionPath, version }) => `${versionPath}: ${version}`).join('\n');
    throw new Error(`Release tag ${tagName} does not match repository version files.\nExpected: ${tagVersion}\n${details}`);
  }

  const headCommit = git.text(['rev-parse', 'HEAD']);
  const tagCommit = git.text(['rev-list', '-n', '1', `refs/tags/${tagName}`]);

  if (headCommit !== tagCommit) {
    throw new Error(`Checked-out commit ${headCommit} does not match tag ${tagName} target ${tagCommit}.`);
  }

  if (!git.succeeds(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'])) {
    throw new Error('Cannot verify release provenance because refs/remotes/origin/main is unavailable.');
  }

  if (!git.succeeds(['merge-base', '--is-ancestor', tagCommit, 'refs/remotes/origin/main'])) {
    throw new Error(`Tag ${tagName} target ${tagCommit} is not reachable from origin/main.`);
  }

  return {
    tagName,
    version: tagVersion,
    commit: tagCommit,
  };
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    const result = validateReleaseTag();
    console.log(`Release tag check passed: ${result.tagName} (${result.commit})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
