import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { verifyPublishedUpdater } from './verify-published-updater.mjs';

test('release workflow forwards the tag directly to the published updater verifier', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );

  assert.match(
    workflow,
    /run: pnpm run verify:published-updater \$\{\{ github\.ref_name \}\}/,
  );
});

const MANIFEST_URL = 'https://github.com/example/ambit/releases/latest/download/latest.json';
const NSIS_ASSET_URL = 'https://api.github.com/repos/example/ambit/releases/assets/42';
const MSI_ASSET_URL = 'https://api.github.com/repos/example/ambit/releases/assets/43';
const NSIS_INSTALLER = Buffer.from('TVphbWJpdC10ZXN0LWluc3RhbGxlcg==', 'base64');
const FOREIGN_ASSET_URL = 'https://api.github.com/repos/other/ambit/releases/assets/44';
const MSI_INSTALLER = Buffer.from('0M8R4KGxGuFhbWJpdC10ZXN0LW1zaQ==', 'base64');
const NSIS_SHA256 = 'a5ae64dfd453dc3e05a520145ade574aebd7f1ac167143b135e2a483c601beae';
const MSI_SHA256 = '206d9011b92c2961d4fe09f153f392d56984504e33218869e6e1db8da782c36b';
const PUBLIC_KEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgdGVzdApSV1FCQWdNRUJRWUhDQU9oQjcvenpoQytIWERkR09kTHdKbG41Tll3bTZVTlh4M2NobVFTVlRHNAo=';
const NSIS_SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRlc3Qga2V5ClJVUUJBZ01FQlFZSENIbk5tUmV5SEJHb3VXWEc3N2R5VGdMZ05BSlc4TlFlWmNnTjFhMUQyTFMzNjd2aXF5OG1IQ29BMmdJMlZ2LzJyd3NSVFFlZUI0V05UWmU3aUtGUEtRWT0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MTc4NzkzMjgwMAlmaWxlOkFtYml0XzkuOS45X3g2NC1zZXR1cC5leGUKc1NjMVEzc241K0VCU1plbEJKL2xoMVVJZzVMWEY0OUhjYm5Lem9oUGxIRDRaeUZDUHF5NnZtYzFYVHZmTkZadktSdEJZa0k1U2hENXZueUhaTVlLQmc9PQo=';
const MSI_SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRlc3Qga2V5ClJVUUJBZ01FQlFZSENFeG1Fa0V5SzNJODJXZnRwaTd0WjdYbUlXMC9yZzh4bitaUVpoRG16MW1wR3gwS2dnb3dpRmpvZTc2RElSM2RkZG4xemJ5RGxCcW15anpSMDc4WmNnRT0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MTc4NzkzMjgwMAlmaWxlOkFtYml0XzkuOS45X3g2NF9lbi1VUy5tc2kKYTFra1hSRnpVU2FtdnRjVzE0NkFHUjZzU1FKeGlacnhYUm9tbzNZQ28wTkc4SC9oQXE1c0Z5TklKRG9WNUhadnNrNkZ6N0tHL3hzdDMrN2RCaW12QXc9PQo=';

const manifest = {
  version: '9.9.9',
  platforms: {
    'windows-x86_64': { signature: NSIS_SIGNATURE, url: NSIS_ASSET_URL },
    'windows-x86_64-nsis': { signature: NSIS_SIGNATURE, url: NSIS_ASSET_URL },
    'windows-x86_64-msi': { signature: MSI_SIGNATURE, url: MSI_ASSET_URL },
  },
};

const nsisAsset = {
  name: 'Ambit_9.9.9_x64-setup.exe',
  state: 'uploaded',
  size: NSIS_INSTALLER.length,
  digest: `sha256:${NSIS_SHA256}`,
};

const msiAsset = {
  name: 'Ambit_9.9.9_x64_en-US.msi',
  state: 'uploaded',
  size: MSI_INSTALLER.length,
  digest: `sha256:${MSI_SHA256}`,
};

const createFetch = ({
  manifestValue = manifest,
  assetValue = nsisAsset,
  installer = NSIS_INSTALLER,
  msiAssetValue = msiAsset,
  msiInstaller = MSI_INSTALLER,
  binaryStatus = 200,
} = {}) => {
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (url === MANIFEST_URL) {
      return Response.json(manifestValue);
    }

    if (
      (url === NSIS_ASSET_URL || url === MSI_ASSET_URL) &&
      options.headers?.Accept === 'application/octet-stream'
    ) {
      const bytes = url === NSIS_ASSET_URL ? installer : msiInstaller;
      return new Response(binaryStatus === 200 ? bytes : 'Request failed', {
        status: binaryStatus,
        statusText: binaryStatus === 200 ? 'OK' : 'Forbidden',
      });
    }

    if (url === NSIS_ASSET_URL) {
      return Response.json(assetValue);
    }

    if (url === MSI_ASSET_URL) {
      return Response.json(msiAssetValue);
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
        platforms: ['windows-x86_64', 'windows-x86_64-nsis'],
        bytes: NSIS_INSTALLER.length,
        sha256: NSIS_SHA256,
      },
      {
        name: 'Ambit_9.9.9_x64_en-US.msi',
        platforms: ['windows-x86_64-msi'],
        bytes: MSI_INSTALLER.length,
        sha256: MSI_SHA256,
      },
    ],
  });

  const binaryRequests = calls.filter(
    ({ options }) => options.headers?.Accept === 'application/octet-stream',
  );
  assert.equal(binaryRequests.length, 2);
  assert.ok(binaryRequests.every(
    ({ options }) => options.headers['User-Agent'] === 'tauri-plugin-updater/2.10.1',
  ));
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
    assetValue: { ...nsisAsset, digest: `sha256:${'0'.repeat(64)}` },
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
      ...nsisAsset,
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
      ...nsisAsset,
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

test('rejects an unsupported Minisign public-key algorithm marker', async () => {
  const publicKeyLines = Buffer.from(PUBLIC_KEY, 'base64').toString('utf8').split('\n');
  const publicKeyPacket = Buffer.from(publicKeyLines[1], 'base64');
  publicKeyPacket.write('XX', 0, 'ascii');
  publicKeyLines[1] = publicKeyPacket.toString('base64');
  const invalidPublicKey = Buffer.from(publicKeyLines.join('\n'), 'utf8').toString('base64');
  const { fetchImpl } = createFetch();

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: invalidPublicKey,
      fetchImpl,
    }),
    /unsupported Minisign algorithm marker XX/,
  );
});

test('rejects a Minisign signature created with a different key ID', async () => {
  const signatureLines = Buffer.from(NSIS_SIGNATURE, 'base64').toString('utf8').split('\n');
  const primaryPacket = Buffer.from(signatureLines[1], 'base64');
  primaryPacket[2] ^= 0xff;
  signatureLines[1] = primaryPacket.toString('base64');
  const wrongKeySignature = Buffer.from(signatureLines.join('\n'), 'utf8').toString('base64');
  const { fetchImpl } = createFetch({
    manifestValue: {
      ...manifest,
      platforms: {
        ...manifest.platforms,
        'windows-x86_64': { signature: wrongKeySignature, url: NSIS_ASSET_URL },
        'windows-x86_64-nsis': { signature: wrongKeySignature, url: NSIS_ASSET_URL },
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
    /signature was created with a different key/,
  );
});

test('rejects a tampered Minisign trusted comment', async () => {
  const signatureLines = Buffer.from(NSIS_SIGNATURE, 'base64').toString('utf8').split('\n');
  signatureLines[2] += '-tampered';
  const tamperedSignature = Buffer.from(signatureLines.join('\n'), 'utf8').toString('base64');
  const { fetchImpl } = createFetch({
    manifestValue: {
      ...manifest,
      platforms: {
        ...manifest.platforms,
        'windows-x86_64': { signature: tamperedSignature, url: NSIS_ASSET_URL },
        'windows-x86_64-nsis': { signature: tamperedSignature, url: NSIS_ASSET_URL },
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
    /trusted-comment verification failed/,
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
        'windows-x86_64-nsis': { signature: 'conflicting-signature', url: NSIS_ASSET_URL },
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

test('rejects an MSI platform that reuses the signed NSIS artifact', async () => {
  const { fetchImpl } = createFetch({
    manifestValue: {
      ...manifest,
      platforms: {
        ...manifest.platforms,
        'windows-x86_64-msi': {
          signature: NSIS_SIGNATURE,
          url: NSIS_ASSET_URL,
        },
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
    /windows-x86_64-msi must reference Ambit_9\.9\.9_x64_en-US\.msi/,
  );
});

test('rejects a signed installer from a different release version', async () => {
  const { fetchImpl } = createFetch({
    assetValue: {
      ...nsisAsset,
      name: 'Ambit_9.9.8_x64-setup.exe',
    },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
    }),
    /windows-x86_64 must reference Ambit_9\.9\.9_x64-setup\.exe/,
  );
});

test('rejects an updater artifact from a different GitHub repository', async () => {
  const { fetchImpl } = createFetch({
    manifestValue: {
      ...manifest,
      platforms: {
        ...manifest.platforms,
        'windows-x86_64-msi': { signature: MSI_SIGNATURE, url: FOREIGN_ASSET_URL },
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
    /must belong to GitHub repository example\/ambit/,
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

test('does not retry malformed manifest JSON', async () => {
  let manifestAttempts = 0;
  const fetchImpl = async () => {
    manifestAttempts += 1;
    return new Response('{not-json', {
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
      retryDelaysMs: [0, 0],
    }),
    { name: 'SyntaxError' },
  );

  assert.equal(manifestAttempts, 1);
});

test('does not retry a manifest without a valid version', async () => {
  const { calls, fetchImpl } = createFetch({
    manifestValue: { platforms: manifest.platforms },
  });

  await assert.rejects(
    verifyPublishedUpdater({
      expectedVersion: '9.9.9',
      manifestUrl: MANIFEST_URL,
      publicKey: PUBLIC_KEY,
      fetchImpl,
      retryDelaysMs: [0, 0],
    }),
    /manifest does not contain a valid version/,
  );

  assert.equal(
    calls.filter(({ url }) => url === MANIFEST_URL).length,
    1,
  );
});

test('retries the complete verification after a response-body network failure', async () => {
  const { fetchImpl: successfulFetch } = createFetch();
  let manifestAttempts = 0;

  const fetchImpl = async (url, options) => {
    if (url === MANIFEST_URL && manifestAttempts++ === 0) {
      return {
        ok: true,
        text: async () => {
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
