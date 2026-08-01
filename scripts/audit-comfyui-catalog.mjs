import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const DEFAULT_MANIFEST_PATH = path.join(
  'src-tauri',
  'src',
  'metadata',
  'comfyui',
  'tests',
  'fixtures',
  'official_catalog',
  'coverage_manifest.json',
);
const DEFAULT_FIXTURE_DIR = path.dirname(DEFAULT_MANIFEST_PATH);
const DIRECT_FIXTURE_PREFIX = 'fixture:official_catalog/';
const MODES = new Set(['verify', 'diff']);
const FORMATS = new Set(['text', 'json']);

const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${label} at ${filePath}: ${message}`);
  }
};

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
};

export const gitBlobHash = (contents) => {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(bytes).digest('hex');
};

export const createGit = (catalogRoot) => {
  const resolvedRoot = path.resolve(catalogRoot);

  return {
    text(args) {
      return execFileSync(
        'git',
        ['-c', `safe.directory=${resolvedRoot.replaceAll('\\', '/')}`, '-C', resolvedRoot, ...args],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ).trim();
    },
  };
};

const loadManifest = (manifestPath) => {
  const manifest = readJson(manifestPath, 'coverage manifest');
  assertObject(manifest, 'Coverage manifest');
  assertObject(manifest.source, 'Coverage manifest source');

  if (!Array.isArray(manifest.entries)) {
    throw new Error('Coverage manifest entries must be an array.');
  }

  const entriesById = new Map();
  let previousId;

  for (const entry of manifest.entries) {
    assertObject(entry, 'Coverage manifest entry');

    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error('Every coverage manifest entry must have a non-empty id.');
    }
    if (entriesById.has(entry.id)) {
      throw new Error(`Duplicate coverage manifest id: ${entry.id}`);
    }
    if (previousId !== undefined && previousId >= entry.id) {
      throw new Error(`Coverage manifest ids must be sorted: ${previousId} precedes ${entry.id}.`);
    }
    if (!/^[0-9a-f]{40}$/.test(entry.source_blob)) {
      throw new Error(`Coverage manifest entry ${entry.id} has an invalid source_blob.`);
    }
    if (!Array.isArray(entry.evidence)) {
      throw new Error(`Coverage manifest entry ${entry.id} must have an evidence array.`);
    }

    entriesById.set(entry.id, entry);
    previousId = entry.id;
  }

  if (manifest.counts?.catalog_entries !== manifest.entries.length) {
    throw new Error(
      `Coverage manifest count ${manifest.counts?.catalog_entries ?? '<missing>'} does not match ${manifest.entries.length} entries.`,
    );
  }

  return { manifest, entriesById };
};

const flattenCatalogIndex = (catalogRoot, indexPath) => {
  const absoluteIndexPath = path.join(catalogRoot, indexPath);
  const modules = readJson(absoluteIndexPath, 'catalog index');

  if (!Array.isArray(modules)) {
    throw new Error('Catalog index must be an array of modules.');
  }

  const templatesById = new Map();

  for (const [moduleIndex, module] of modules.entries()) {
    assertObject(module, `Catalog module ${moduleIndex}`);
    if (!Array.isArray(module.templates)) {
      throw new Error(`Catalog module ${moduleIndex} must have a templates array.`);
    }

    for (const [templateIndex, template] of module.templates.entries()) {
      assertObject(template, `Catalog template ${moduleIndex}:${templateIndex}`);
      const id = template.name;

      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(`Catalog template ${moduleIndex}:${templateIndex} must have a non-empty name.`);
      }
      if (templatesById.has(id)) {
        throw new Error(`Duplicate catalog template id: ${id}`);
      }

      const workflowPath = path.join(catalogRoot, 'templates', `${id}.json`);
      let workflowBytes;
      try {
        workflowBytes = fs.readFileSync(workflowPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not read catalog workflow ${id} at ${workflowPath}: ${message}`);
      }

      let canonicalWorkflow;
      try {
        canonicalWorkflow = JSON.stringify(JSON.parse(workflowBytes.toString('utf8')));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Catalog workflow ${id} is not valid JSON: ${message}`);
      }

      templatesById.set(id, {
        id,
        category: module.title ?? null,
        mediaType: template.mediaType ?? null,
        models: Array.isArray(template.models) ? template.models : [],
        tags: Array.isArray(template.tags) ? template.tags : [],
        openSource: template.openSource ?? null,
        workflowBytes,
        canonicalWorkflow,
        sourceBlob: gitBlobHash(workflowBytes),
      });
    }
  }

  return templatesById;
};

const directFixtureRelativePath = (entry) => {
  const expectedName = `${entry.id}.chunks.json`;

  for (const evidence of entry.evidence) {
    if (typeof evidence !== 'string' || !evidence.startsWith(DIRECT_FIXTURE_PREFIX)) {
      continue;
    }

    const relativePath = evidence.slice(DIRECT_FIXTURE_PREFIX.length);
    if (path.basename(relativePath) === expectedName) {
      return relativePath;
    }
  }

  return null;
};

const auditDedicatedFixtures = (entries, fixtureDir) => {
  const fixturesById = new Map();

  for (const entry of entries) {
    const relativePath = directFixtureRelativePath(entry);
    if (!relativePath) {
      continue;
    }

    const absolutePath = path.resolve(fixtureDir, relativePath);
    const relativeToFixtureDir = path.relative(path.resolve(fixtureDir), absolutePath);
    if (relativeToFixtureDir.startsWith('..') || path.isAbsolute(relativeToFixtureDir)) {
      throw new Error(`Fixture evidence for ${entry.id} escapes the official catalog fixture directory.`);
    }

    const fixture = readJson(absolutePath, `fixture for ${entry.id}`);
    assertObject(fixture, `Fixture for ${entry.id}`);
    if (typeof fixture.workflow !== 'string') {
      throw new Error(`Fixture for ${entry.id} must contain a workflow string.`);
    }

    let canonicalWorkflow;
    try {
      canonicalWorkflow = JSON.stringify(JSON.parse(fixture.workflow));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Fixture ${relativePath} for ${entry.id} has invalid workflow JSON: ${message}`);
    }
    fixturesById.set(entry.id, { relativePath, canonicalWorkflow });
  }

  return fixturesById;
};

const compareIds = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sorted = (values) => [...values].sort(compareIds);

const verifyPinnedCatalog = ({ manifest, entriesById, templatesById, fixturesById, catalogCommit }) => {
  if (catalogCommit !== manifest.source.commit) {
    throw new Error(
      `Catalog checkout commit ${catalogCommit} does not match pinned manifest commit ${manifest.source.commit}.`,
    );
  }

  const manifestIds = new Set(entriesById.keys());
  const catalogIds = new Set(templatesById.keys());
  const missingIds = sorted([...manifestIds].filter((id) => !catalogIds.has(id)));
  const extraIds = sorted([...catalogIds].filter((id) => !manifestIds.has(id)));

  if (missingIds.length > 0 || extraIds.length > 0) {
    throw new Error(
      `Catalog id mismatch. Missing: ${missingIds.join(', ') || '<none>'}. Extra: ${extraIds.join(', ') || '<none>'}.`,
    );
  }

  const blobMismatches = [];
  for (const [id, entry] of entriesById) {
    const template = templatesById.get(id);
    if (template.sourceBlob !== entry.source_blob) {
      blobMismatches.push(`${id}: ${template.sourceBlob} != ${entry.source_blob}`);
    }
  }
  if (blobMismatches.length > 0) {
    throw new Error(`Catalog source blob mismatch:\n${blobMismatches.join('\n')}`);
  }

  for (const [id, fixture] of fixturesById) {
    const template = templatesById.get(id);
    if (template.canonicalWorkflow !== fixture.canonicalWorkflow) {
      throw new Error(`Fixture ${fixture.relativePath} does not preserve the canonical upstream workflow for ${id}.`);
    }
  }

  return {
    mode: 'verify',
    release: manifest.source.release_tag,
    manifestCommit: manifest.source.commit,
    catalogCommit,
    manifestEntries: entriesById.size,
    catalogEntries: templatesById.size,
    verifiedSourceBlobs: entriesById.size,
    verifiedFixtures: fixturesById.size,
  };
};

const compareCatalog = ({ manifest, entriesById, templatesById, fixturesById, catalogCommit }) => {
  const manifestIds = new Set(entriesById.keys());
  const catalogIds = new Set(templatesById.keys());
  const added = sorted([...catalogIds].filter((id) => !manifestIds.has(id))).map((id) => {
    const template = templatesById.get(id);
    return {
      id,
      category: template.category,
      mediaType: template.mediaType,
      models: template.models,
      tags: template.tags,
      openSource: template.openSource,
      candidateBlob: template.sourceBlob,
    };
  });
  const removed = sorted([...manifestIds].filter((id) => !catalogIds.has(id))).map((id) => {
    const entry = entriesById.get(id);
    return { id, scope: entry.scope, coverage: entry.coverage, manifestBlob: entry.source_blob };
  });
  const changed = sorted(
    [...manifestIds].filter(
      (id) => catalogIds.has(id) && entriesById.get(id).source_blob !== templatesById.get(id).sourceBlob,
    ),
  ).map((id) => {
    const entry = entriesById.get(id);
    const template = templatesById.get(id);
    return {
      id,
      scope: entry.scope,
      coverage: entry.coverage,
      manifestBlob: entry.source_blob,
      candidateBlob: template.sourceBlob,
      hasDedicatedFixture: fixturesById.has(id),
    };
  });
  const changedTargeted = changed.filter((entry) => entry.scope !== 'excluded');
  const changedExcluded = changed.filter((entry) => entry.scope === 'excluded');
  const staleFixtures = sorted(
    [...fixturesById].flatMap(([id, fixture]) => {
      const candidate = templatesById.get(id);
      return !candidate || candidate.canonicalWorkflow !== fixture.canonicalWorkflow ? [id] : [];
    }),
  );

  return {
    mode: 'diff',
    release: manifest.source.release_tag,
    manifestCommit: manifest.source.commit,
    catalogCommit,
    manifestEntries: entriesById.size,
    catalogEntries: templatesById.size,
    unchangedEntries: entriesById.size - removed.length - changed.length,
    added,
    removed,
    changedTargeted,
    changedExcluded,
    staleFixtures,
  };
};

export const auditCatalog = ({
  projectRoot = process.cwd(),
  catalogRoot,
  manifestPath = path.join(projectRoot, DEFAULT_MANIFEST_PATH),
  fixtureDir = path.join(projectRoot, DEFAULT_FIXTURE_DIR),
  mode = 'verify',
  git,
} = {}) => {
  if (!catalogRoot) {
    throw new Error('A catalog checkout path is required. Pass --catalog-root <path>.');
  }
  if (!MODES.has(mode)) {
    throw new Error(`Unsupported audit mode: ${mode}. Expected verify or diff.`);
  }

  const resolvedCatalogRoot = path.resolve(catalogRoot);
  const { manifest, entriesById } = loadManifest(path.resolve(manifestPath));
  const templatesById = flattenCatalogIndex(resolvedCatalogRoot, manifest.source.index_path);
  const fixturesById = auditDedicatedFixtures(manifest.entries, path.resolve(fixtureDir));
  const catalogGit = git ?? createGit(resolvedCatalogRoot);
  const catalogCommit = catalogGit.text(['rev-parse', 'HEAD']);

  const context = { manifest, entriesById, templatesById, fixturesById, catalogCommit };
  return mode === 'verify' ? verifyPinnedCatalog(context) : compareCatalog(context);
};

const renderList = (label, entries, formatEntry) => {
  const lines = [`${label}: ${entries.length}`];
  for (const entry of entries) {
    lines.push(`  ${formatEntry(entry)}`);
  }
  return lines;
};

export const renderAuditResult = (result) => {
  if (result.mode === 'verify') {
    return [
      'ComfyUI catalog verification passed.',
      `Pinned release: ${result.release}`,
      `Manifest commit: ${result.manifestCommit}`,
      `Catalog commit: ${result.catalogCommit}`,
      `Entries: ${result.catalogEntries}`,
      `Verified source blobs: ${result.verifiedSourceBlobs}`,
      `Verified dedicated fixtures: ${result.verifiedFixtures}`,
    ].join('\n');
  }

  return [
    'ComfyUI catalog drift report.',
    `Baseline: ${result.release} (${result.manifestCommit})`,
    `Candidate: ${result.catalogCommit}`,
    `Entries: ${result.manifestEntries} -> ${result.catalogEntries}`,
    `Unchanged: ${result.unchangedEntries}`,
    ...renderList('Added', result.added, (entry) => entry.id),
    ...renderList('Removed', result.removed, (entry) => `${entry.id} [${entry.scope}/${entry.coverage}]`),
    ...renderList(
      'Changed targeted',
      result.changedTargeted,
      (entry) => `${entry.id} [${entry.coverage}]`,
    ),
    ...renderList(
      'Changed excluded',
      result.changedExcluded,
      (entry) => `${entry.id} [${entry.coverage}]`,
    ),
    ...renderList('Stale dedicated fixtures', result.staleFixtures, (id) => id),
  ].join('\n');
};

export const parseArgs = (args) => {
  const options = { mode: 'verify', format: 'text' };
  const optionNames = {
    '--catalog-root': 'catalogRoot',
    '--mode': 'mode',
    '--format': 'format',
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      continue;
    }
    const optionName = optionNames[argument];
    if (optionName) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      options[optionName] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!MODES.has(options.mode)) {
    throw new Error(`Unsupported audit mode: ${options.mode}. Expected verify or diff.`);
  }
  if (!FORMATS.has(options.format)) {
    throw new Error(`Unsupported output format: ${options.format}. Expected text or json.`);
  }

  return options;
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = auditCatalog({ catalogRoot: options.catalogRoot, mode: options.mode });
    console.log(options.format === 'json' ? JSON.stringify(result, null, 2) : renderAuditResult(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
