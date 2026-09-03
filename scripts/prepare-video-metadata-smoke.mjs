import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_FIXTURE = 'video_ltx2_3_t2v';
const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv']);
const FIXTURE_DIRECTORY = path.join(
  'src-tauri', 'src', 'metadata', 'comfyui', 'tests', 'fixtures', 'official_video',
);

const videoArgument = process.argv[2];
const fixtureId = process.argv[3] ?? DEFAULT_FIXTURE;
const force = process.argv.includes('--force');

if (!videoArgument) {
  throw new Error(
    'Usage: pnpm run prepare:video-metadata-smoke -- <video-path> [fixture-id] [--force]',
  );
}

const videoPath = path.resolve(videoArgument);
const videoStats = fs.lstatSync(videoPath);
if (!videoStats.isFile() || videoStats.isSymbolicLink()) {
  throw new Error(`Video must be a regular, non-symlink file: ${videoPath}`);
}
if (!SUPPORTED_EXTENSIONS.has(path.extname(videoPath).toLowerCase())) {
  throw new Error(`Unsupported video extension: ${path.extname(videoPath)}`);
}
if (!/^[a-zA-Z0-9_-]+$/.test(fixtureId)) {
  throw new Error(`Invalid fixture id: ${fixtureId}`);
}

const fixturePath = path.resolve(FIXTURE_DIRECTORY, `${fixtureId}.json`);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (!fixture.workflow || fixture.catalogId !== fixtureId) {
  throw new Error(`Invalid pinned fixture: ${fixturePath}`);
}

const parsedVideoPath = path.parse(videoPath);
const sidecarPath = path.join(parsedVideoPath.dir, `${parsedVideoPath.name}.workflow.json`);
if (fs.existsSync(sidecarPath) && !force) {
  throw new Error(`Sidecar already exists; pass --force to replace it: ${sidecarPath}`);
}

const sidecar = {
  media: parsedVideoPath.base,
  workflow: fixture.workflow,
};
fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar)}\n`, {
  encoding: 'utf8',
  flag: force ? 'w' : 'wx',
});

console.log(`Created trusted video metadata sidecar: ${sidecarPath}`);
console.log(`Pinned workflow: ${fixture.catalogId} @ ${fixture.catalogCommit}`);
