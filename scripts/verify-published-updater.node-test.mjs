import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { verifyPublishedUpdater } from './verify-published-updater.mjs';

const MANIFEST_URL = 'https://example.test/latest.json';
const ASSET_URL = 'https://api.github.com/repos/example/ambit/releases/assets/42';
const INSTALLER = Buffer.from('TVphbWJpdC10ZXN0LWluc3RhbGxlcg==', 'base64');
const INSTALLER_SHA256 = 'a5ae64dfd453dc3e05a520145ade574aebd7f1ac167143b135e2a483c601beae';
const PUBLIC_KEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgdGVzdApSV1FCQWdNRUJRWUhDQU9oQjcvenpoQytIWERkR09kTHdKbG41Tll3bTZVTlh4M2NobVFTVlRHNAo=';
const SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRlc3Qga2V5ClJVUUJBZ01FQlFZSENIbk5tUmV5SEJHb3VXWEc3N2R5VGdMZ05BSlc4TlFlWmNnTjFhMUQyTFMzNjd2aXF5OG1IQ29BMmdJMlZ2LzJyd3NSVFFlZUI0V05UWmU3aUtGUEtRWT0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MTc4NzkzMjgwMAlmaWxlOkFtYml0XzkuOS45X3g2NC1zZXR1cC5leGUKc1NjMVEzc241K0VCU1plbEJKL2xoMVVJZzVMWEY0OUhjYm5Lem9oUGxIRDRaeUZDUHF5NnZtYzFYVHZmTkZadktSdEJZa0k1U2hENXZueUhaTVlLQmc9PQo=';

const manifest = {
  version: '9.9.9',
  platforms: {
    'windows-x86_64': { signature: SIGNATURE, url: ASSET_URL },
    'windows-x86_64-nsis': { signature: SIGNATURE, url: ASSET_URL },
    'windows-x86_64-msi': { signature: SIGNATURE, url: ASSET_URL },
  },
};

const asset = {
  name: 'Ambit_9.9.9_x64-setup.exe',
  state: 'uploaded',
  size: INSTALLER.length,
  digest: `sha256:${INSTALLER_SHA256}`,
};

const createFetch = ({
  manifestValue = manifest,
  assetValue = asset,
  installer = INSTALLER,
  binaryStatus = 200,
} = {}) => {
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (url === MANIFEST_URL) {
      return Response.json(manifestValue);
    }

    if (url === ASSET_URL && options.headers?.Accept === 'application/octet-stream') {
      return new Response(binaryStatus === 200 ? installer : 'Request failed', {
        status: binaryStatus,
        statusText: binaryStatus === 200 ? 'OK' : 'Forbidden',
      });
    }

    if (url === ASSET_URL) {
      return Response.json(assetValue);
    }

    return new Response('Not found', { status: 404 });
  };

  return { calls, fetchImpl };
};

test('verifies a publicly downloadable signed Windows updater artifact', async () => {
  const { calls, fetchImpl } = createFetch();

  const result = await verifyPublishedUpdater({
    expectedVersion: 'v9.9.9',
    manifestUrl: MANIFEST_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl,
  });

  assert.deepEqual(result, {
    version: '9.9.9',
    artifacts: [
      {
        name: 'Ambit_9.9.9_x64-setup.exe',
        platforms: [
          'windows-x86_64',
          'windows-x86_64-nsis',
          'windows-x86_64-msi',
        ],
        bytes: INSTALLER.length,
        sha256: INSTALLER_SHA256,
      },
    ],
  });

  const binaryRequest = calls.find(({ options }) => options.headers?.Accept === 'application/octet-stream');
  assert.equal(binaryRequest?.options.headers['User-Agent'], 'tauri-plugin-updater/2.10.1');
});
test('rejects a manifest for a different release version', async () => {
  const { fetchImpl } = createFetch({
    manifestValue: { ...manifest, version: '9.9.8' },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: 'v9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
      retryDelaysMs: [],
    }),
    /manifest version 9\.9\.8 does not match 9\.9\.9/,
  );
});

test('rejects an updater artifact that is not publicly downloadable', async () => {
  const { fetchImpl } = createFetch({ binaryStatus: 403 });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
    }),
    /Updater artifact request failed with status 403 Forbidden/,
  );
});

test('rejects an updater artifact whose GitHub digest does not match', async () => {
  const { fetchImpl } = createFetch({
    assetValue: { ...asset, digest: `sha256:${'0'.repeat(64)}` },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
    }),
    /SHA-256 mismatch/,
  );
});

test('rejects an updater artifact whose bytes do not match its installer format', async () => {
  const malformedInstaller = Buffer.from('bm90LWFuLWluc3RhbGxlcg==', 'base64');
  const { fetchImpl } = createFetch({
    installer: malformedInstaller,
    assetValue: {
      ...asset,
      size: malformedInstaller.length,
      digest: 'sha256:a868128f565df09533eab3fa8194612f5bcd334f5b72469cdcc4b5f75e2fb301',
    },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
    }),
    /does not match its installer format/,
  );
});

test('rejects an updater artifact whose signature does not match its bytes', async () => {
  const corruptedInstaller = Buffer.from('TVphbWJpdC10ZXN0LWluc3RhbGxlUg==', 'base64');
  const { fetchImpl } = createFetch({
    installer: corruptedInstaller,
    assetValue: {
      ...asset,
      size: corruptedInstaller.length,
      digest: 'sha256:619ae686e825094e3e237f70647a071884d312ecec030aab15fbca1034dd32c4',
    },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
    }),
    /artifact signature verification failed/,
  );
});

test('CLI rejects a missing expected release version before making requests', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-published-updater.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_NAME: '' },
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Usage: node scripts\/verify-published-updater\.mjs <version-or-tag>/,
  );
});
test('rejects one asset URL reused with conflicting signatures', async () => {
  const { fetchImpl } = createFetch({
    manifestValue: {
      ...manifest,
      platforms: {
        ...manifest.platforms,
        'windows-x86_64-nsis': { signature: 'conflicting-signature', url: ASSET_URL },
      },
    },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
    }),
    /conflicting signatures/,
  );
});

test('rejects a manifest missing a required Windows updater platform', async () => {
  const { ['windows-x86_64-msi']: _missing, ...platforms } = manifest.platforms;
  const { fetchImpl } = createFetch({
    manifestValue: { ...manifest, platforms },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
    }),
    /missing required platform windows-x86_64-msi/,
  );
});

for (const missingPlatform of ['windows-x86_64', 'windows-x86_64-nsis']) {
  test(`rejects a manifest missing required platform ${missingPlatform}`, async () => {
    const platforms = Object.fromEntries(
      Object.entries(manifest.platforms).filter(([platform]) => platform !== missingPlatform),
    );
    const { fetchImpl } = createFetch({
      manifestValue: { ...manifest, platforms },
    });

    await assert.rejects(
      verifyPublishedUpdater({
        expectedVersion: '9.9.9',
        manifestUrl: MANIFEST_URL,
        publicKey: PUBLIC_KEY,
        fetchImpl,
      }),
      new RegExp(`missing required platform ${missingPlatform}`),
    );
  });
}

test('retries the complete verification after a transient manifest failure', async () => {
  const { fetchImpl: successfulFetch } = createFetch();
  let manifestAttempts = 0;

  const fetchImpl = async (url, options) => {
    if (url === MANIFEST_URL && manifestAttempts++ === 0) {
      return new Response('Try again', { status: 503, statusText: 'Service Unavailable' });
    }

    return successfulFetch(url, options);
  };

  const result = await verifyPublishedUpdater({
    expectedVersion: '9.9.9',
    manifestUrl: MANIFEST_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl,
    retryDelaysMs: [0],
  });

  assert.equal(result.version, '9.9.9');
  assert.equal(manifestAttempts, 2);
});

test('retries the complete verification while the public manifest is stale', async () => {
  const { fetchImpl: successfulFetch } = createFetch();
  let manifestAttempts = 0;

  const fetchImpl = async (url, options) => {
    if (url === MANIFEST_URL && manifestAttempts++ === 0) {
      return Response.json({ ...manifest, version: '9.9.8' });
    }

    return successfulFetch(url, options);
  };

  const result = await verifyPublishedUpdater({
    expectedVersion: '9.9.9',
    manifestUrl: MANIFEST_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl,
    retryDelaysMs: [0],
  });

  assert.equal(result.version, '9.9.9');
  assert.equal(manifestAttempts, 2);
});

test('retries the complete verification after a response-body network failure', async () => {
  const { fetchImpl: successfulFetch } = createFetch();
  let manifestAttempts = 0;

  const fetchImpl = async (url, options) => {
    if (url === MANIFEST_URL && manifestAttempts++ === 0) {
      return {
        ok: true,
        json: async () => {
          throw new TypeError('terminated');
        },
      };
    }

    return successfulFetch(url, options);
  };

  const result = await verifyPublishedUpdater({
    expectedVersion: '9.9.9',
    manifestUrl: MANIFEST_URL,
    publicKey: PUBLIC_KEY,
    fetchImpl,
    retryDelaysMs: [0],
  });

  assert.equal(result.version, '9.9.9');
  assert.equal(manifestAttempts, 2);
});
