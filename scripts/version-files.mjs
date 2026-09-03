import fs from 'node:fs';
import path from 'node:path';

const readJsonVersion = (contents) => JSON.parse(contents).version;

const readCargoManifestVersion = (contents) => {
  const packageHeader = contents.match(/^\[package\]\s*$/m);

  if (!packageHeader || packageHeader.index === undefined) {
    throw new Error('Could not find [package] in src-tauri/Cargo.toml.');
  }

  const afterHeader = contents.slice(packageHeader.index + packageHeader[0].length);
  const nextSectionIndex = afterHeader.search(/^\[/m);
  const packageSection = nextSectionIndex === -1 ? afterHeader : afterHeader.slice(0, nextSectionIndex);
  const versionMatch = packageSection.match(/^version\s*=\s*"([^"]+)"$/m);

  if (!versionMatch) {
    throw new Error('Could not find the package version in src-tauri/Cargo.toml.');
  }

  return versionMatch[1];
};

const readCargoLockVersion = (contents) => {
  const appPackages = contents
    .split(/(?=^\[\[package\]\]\s*$)/m)
    .filter((packageBlock) => /^name\s*=\s*"app"\s*$/m.test(packageBlock));

  if (appPackages.length !== 1) {
    throw new Error(`Expected exactly one app package in src-tauri/Cargo.lock, found ${appPackages.length}.`);
  }

  const versionMatch = appPackages[0].match(/^version\s*=\s*"([^"]+)"$/m);

  if (!versionMatch) {
    throw new Error('Could not find the app package version in src-tauri/Cargo.lock.');
  }

  return versionMatch[1];
};

const VERSION_FILES = [
  {
    path: 'package.json',
    readVersion: readJsonVersion,
  },
  {
    path: 'src-tauri/tauri.conf.json',
    readVersion: readJsonVersion,
  },
  {
    path: 'src-tauri/tauri.dev.json',
    readVersion: readJsonVersion,
  },
  {
    path: 'src-tauri/Cargo.toml',
    readVersion: readCargoManifestVersion,
  },
  {
    path: 'src-tauri/Cargo.lock',
    readVersion: readCargoLockVersion,
  },
  {
    path: '.github/.release-please-manifest.json',
    readVersion: (contents) => JSON.parse(contents)['.'],
  },
];

export const readRepositoryVersions = (rootDir) =>
  VERSION_FILES.map((versionFile) => {
    const absolutePath = path.join(rootDir, versionFile.path);
    const contents = fs.readFileSync(absolutePath, 'utf8');

    return {
      path: versionFile.path,
      version: versionFile.readVersion(contents),
    };
  });
