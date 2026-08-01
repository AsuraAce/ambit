import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditCatalog, gitBlobHash, parseArgs, renderAuditResult } from './audit-comfyui-catalog.mjs';

const makeAuditWorkspace = (
  t,
  {
    baselineWorkflows = {
      alpha: '{\n  "nodes": [{"id": 1}]\n}\n',
      beta: '{"nodes":[{"id":2}]}\n',
    },
    candidateWorkflows = baselineWorkflows,
    fixtureIds = ['alpha'],
    fixtureOverrides = {},
    candidateCommit = 'baseline-commit',
    templateOrder = Object.keys(candidateWorkflows),
  } = {},
) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambit-comfyui-catalog-audit-'));
  const projectRoot = path.join(rootDir, 'project');
  const catalogRoot = path.join(rootDir, 'catalog');
  const fixtureDir = path.join(projectRoot, 'fixtures');
  const manifestPath = path.join(fixtureDir, 'coverage_manifest.json');

  fs.mkdirSync(path.join(catalogRoot, 'templates'), { recursive: true });
  fs.mkdirSync(fixtureDir, { recursive: true });

  const templates = templateOrder.map((name) => ({ name, mediaType: 'image', openSource: true }));
  fs.writeFileSync(
    path.join(catalogRoot, 'templates', 'index.json'),
    JSON.stringify([{ title: 'Image', templates }]),
  );
  for (const [id, workflow] of Object.entries(candidateWorkflows)) {
    fs.writeFileSync(path.join(catalogRoot, 'templates', `${id}.json`), workflow);
  }

  const entries = Object.entries(baselineWorkflows)
    .map(([id, workflow]) => ({
      id,
      source_blob: gitBlobHash(workflow),
      scope: id === 'beta' ? 'excluded' : 'target_core_image',
      coverage: id === 'beta' ? 'excluded' : 'golden',
      evidence: fixtureIds.includes(id) ? [`fixture:official_catalog/${id}.chunks.json`] : [],
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const manifest = {
    source: {
      release_tag: 'v-test',
      commit: 'baseline-commit',
      index_path: 'templates/index.json',
    },
    counts: { catalog_entries: entries.length },
    entries,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  for (const id of fixtureIds) {
    const workflow = fixtureOverrides[id] ?? JSON.stringify(JSON.parse(baselineWorkflows[id]));
    fs.writeFileSync(path.join(fixtureDir, `${id}.chunks.json`), JSON.stringify({ workflow }));
  }

  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  return {
    catalogRoot,
    fixtureDir,
    manifestPath,
    git: { text: () => candidateCommit },
  };
};

test('verify mode checks the pinned commit, every source blob, and dedicated fixture semantics', (t) => {
  const workspace = makeAuditWorkspace(t);
  const result = auditCatalog({ ...workspace, mode: 'verify' });

  assert.deepEqual(result, {
    mode: 'verify',
    release: 'v-test',
    manifestCommit: 'baseline-commit',
    catalogCommit: 'baseline-commit',
    manifestEntries: 2,
    catalogEntries: 2,
    verifiedSourceBlobs: 2,
    verifiedFixtures: 1,
  });
  assert.match(renderAuditResult(result), /verification passed[\s\S]*Verified dedicated fixtures: 1/);
});

test('verify mode rejects a checkout at the wrong commit', (t) => {
  const workspace = makeAuditWorkspace(t, { candidateCommit: 'different-commit' });

  assert.throws(
    () => auditCatalog({ ...workspace, mode: 'verify' }),
    /different-commit does not match pinned manifest commit baseline-commit/,
  );
});

test('verify mode rejects stale manifest blobs and stale dedicated fixtures', async (t) => {
  await t.test('stale manifest blob', (t) => {
    const workspace = makeAuditWorkspace(t, {
      candidateWorkflows: {
        alpha: '{"nodes":[{"id":99}]}',
        beta: '{"nodes":[{"id":2}]}\n',
      },
    });

    assert.throws(() => auditCatalog({ ...workspace, mode: 'verify' }), /Catalog source blob mismatch/);
  });

  await t.test('stale fixture workflow', (t) => {
    const workspace = makeAuditWorkspace(t, {
      fixtureOverrides: { alpha: '{"nodes":[{"id":99}]}' },
    });

    assert.throws(
      () => auditCatalog({ ...workspace, mode: 'verify' }),
      /does not preserve the canonical upstream workflow for alpha/,
    );
  });
});

test('diff mode reports added, removed, and changed workflows in stable order', (t) => {
  const baselineWorkflows = {
    alpha: '{"nodes":[{"id":1}]}',
    beta: '{"nodes":[{"id":2}]}',
    delta: '{"nodes":[{"id":4}]}',
  };
  const candidateWorkflows = {
    gamma: '{"nodes":[{"id":3}]}',
    delta: '{"nodes":[{"id":44}]}',
    alpha: '{"nodes":[{"id":11}]}',
  };
  const workspace = makeAuditWorkspace(t, {
    baselineWorkflows,
    candidateWorkflows,
    fixtureIds: ['alpha', 'delta'],
    candidateCommit: 'candidate-commit',
    templateOrder: ['gamma', 'delta', 'alpha'],
  });
  const result = auditCatalog({ ...workspace, mode: 'diff' });

  assert.deepEqual(result.added.map((entry) => entry.id), ['gamma']);
  assert.deepEqual(result.removed.map((entry) => entry.id), ['beta']);
  assert.deepEqual(result.changedTargeted.map((entry) => entry.id), ['alpha', 'delta']);
  assert.deepEqual(result.changedExcluded, []);
  assert.deepEqual(result.staleFixtures, ['alpha', 'delta']);
  assert.equal(result.unchangedEntries, 0);
  assert.match(renderAuditResult(result), /Added: 1[\s\S]*Changed targeted: 2/);
});

test('format-only upstream changes do not make a semantically identical fixture stale', (t) => {
  const baseline = '{"nodes":[{"id":1}]}';
  const candidate = '{\n  "nodes": [\n    { "id": 1 }\n  ]\n}\n';
  const workspace = makeAuditWorkspace(t, {
    baselineWorkflows: { alpha: baseline },
    candidateWorkflows: { alpha: candidate },
    fixtureIds: ['alpha'],
    candidateCommit: 'candidate-commit',
  });
  const result = auditCatalog({ ...workspace, mode: 'diff' });

  assert.deepEqual(result.changedTargeted.map((entry) => entry.id), ['alpha']);
  assert.deepEqual(result.staleFixtures, []);
});

test('catalog validation rejects duplicate ids and malformed workflows', async (t) => {
  await t.test('duplicate index ids', (t) => {
    const workspace = makeAuditWorkspace(t, { templateOrder: ['alpha', 'alpha', 'beta'] });
    assert.throws(() => auditCatalog({ ...workspace }), /Duplicate catalog template id: alpha/);
  });

  await t.test('malformed workflow JSON', (t) => {
    const workspace = makeAuditWorkspace(t, {
      candidateWorkflows: { alpha: '{not-json', beta: '{"nodes":[]}' },
    });
    assert.throws(() => auditCatalog({ ...workspace }), /Catalog workflow alpha is not valid JSON/);
  });
});

test('cross-workflow pattern evidence is not treated as direct fixture identity', (t) => {
  const workspace = makeAuditWorkspace(t, { fixtureIds: [] });
  const manifest = JSON.parse(fs.readFileSync(workspace.manifestPath, 'utf8'));
  manifest.entries[0].evidence = ['fixture:official_catalog/beta.chunks.json'];
  fs.writeFileSync(workspace.manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(path.join(workspace.fixtureDir, 'beta.chunks.json'), JSON.stringify({ workflow: '{}' }));

  const result = auditCatalog({ ...workspace, mode: 'verify' });
  assert.equal(result.verifiedFixtures, 0);
});

test('CLI parsing accepts the separator forwarded by pnpm', () => {
  assert.deepEqual(
    parseArgs(['--', '--mode', 'diff', '--format', 'json', '--catalog-root', 'C:\\catalog']),
    { mode: 'diff', format: 'json', catalogRoot: 'C:\\catalog' },
  );
});
