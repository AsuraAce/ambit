import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PINNED_COMMIT = '8f6709b8f6ef808b0eccc47eff28ada4a58adbbe';
const FIXTURES = {
  video_bernini_r_video_editing: 'c940253bf8f46ccafbdb0ce2421df1219e5824ac',
  video_ltx2_3_flf2v: '0dd215a7efb7e9b0b98ff855b0bd9819262cc306',
  video_ltx2_3_ia2v: '0647bb85d97fff3803a3eac3311b269752d640e5',
  video_ltx2_3_t2v: '2ee09ab8e5658aaf11bd345bf339380eb52541b9',
  video_ltx2_canny_to_video: 'a9611e15a40b11f93ce9dac6e1a9e6c5e52b0920',
  video_wan2_2_14B_i2v: '992506d4511acecd3b548869816487450fa94a32',
};

const catalogRoot = process.argv[2];
if (!catalogRoot) throw new Error('Usage: node scripts/sync-video-workflow-fixtures.mjs <workflow_templates checkout>');

const gitDir = path.join(catalogRoot, '.git');
if (!fs.existsSync(gitDir)) throw new Error(`Not a git checkout: ${catalogRoot}`);

const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
const ref = head.startsWith('ref: ')
  ? fs.readFileSync(path.join(gitDir, head.slice(5)), 'utf8').trim()
  : head;
if (ref !== PINNED_COMMIT) throw new Error(`Expected ${PINNED_COMMIT}; found ${ref}`);

const outputDir = path.join(
  'src-tauri', 'src', 'metadata', 'comfyui', 'tests', 'fixtures', 'official_video',
);
fs.mkdirSync(outputDir, { recursive: true });

for (const [id, expectedBlob] of Object.entries(FIXTURES)) {
  const sourcePath = path.join(catalogRoot, 'templates', `${id}.json`);
  const bytes = fs.readFileSync(sourcePath);
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  const blob = crypto.createHash('sha1').update(header).update(bytes).digest('hex');
  if (blob !== expectedBlob) throw new Error(`${id}: expected blob ${expectedBlob}; found ${blob}`);
  const workflow = JSON.parse(bytes.toString('utf8'));
  const fixture = {
    catalogId: id,
    catalogCommit: PINNED_COMMIT,
    sourceBlob: blob,
    workflow,
  };
  fs.writeFileSync(path.join(outputDir, `${id}.json`), `${JSON.stringify(fixture)}\n`);
}

console.log(`Synced ${Object.keys(FIXTURES).length} pinned video workflow fixtures.`);
