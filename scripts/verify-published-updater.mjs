import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const updaterVersion = packageJson.dependencies['@tauri-apps/plugin-updater'];
const UPDATER_USER_AGENT = `tauri-plugin-updater/${updaterVersion}`;
const WINDOWS_PLATFORM_PREFIX = 'windows-';
const REQUIRED_WINDOWS_PLATFORMS = [
  'windows-x86_64',
  'windows-x86_64-nsis',
  'windows-x86_64-msi',
];
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 6_000, 10_000];
const MINISIGN_PUBLIC_KEY_LENGTH = 42;
const MINISIGN_SIGNATURE_LENGTH = 74;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

class RetryableUpdaterVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RetryableUpdaterVerificationError';
  }
}

const responseError = (label, response) =>
  new Error(`${label} request failed with status ${response.status} ${response.statusText}`.trim());

const fetchOk = async (fetchImpl, url, options, label) => {
  let response;

  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RetryableUpdaterVerificationError(
      `${label} request failed: ${message}`,
    );
  }

  if (!response.ok) {
    const error = responseError(label, response);

    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new RetryableUpdaterVerificationError(error.message);
    }

    throw error;
  }

  return response;
};

const readResponseBody = async (response, method, label) => {
  try {
    return await response[method]();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RetryableUpdaterVerificationError(
      `${label} response body failed: ${message}`,
    );
  }
};

const readJson = (response, label) => readResponseBody(response, 'json', label);
const readBytes = (response, label) => readResponseBody(response, 'arrayBuffer', label);

const decodeOuterBase64Text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty base64 string.`);
  }

  return Buffer.from(value, 'base64').toString('utf8');
};

const parsePublicKey = (encodedPublicKey) => {
  const lines = decodeOuterBase64Text(encodedPublicKey, 'Updater public key').trim().split(/\r?\n/);
  const bytes = Buffer.from(lines[1] ?? '', 'base64');

  if (bytes.length !== MINISIGN_PUBLIC_KEY_LENGTH) {
    throw new Error('Updater public key is not a valid Minisign public key.');
  }

  return {
    keyId: bytes.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, bytes.subarray(10)]),
      format: 'der',
      type: 'spki',
    }),
  };
};

const parseSignature = (encodedSignature) => {
  const lines = decodeOuterBase64Text(encodedSignature, 'Updater signature').trim().split(/\r?\n/);
  const primary = Buffer.from(lines[1] ?? '', 'base64');
  const trustedCommentPrefix = 'trusted comment: ';
  const trustedCommentLine = lines[2] ?? '';
  const globalSignature = Buffer.from(lines[3] ?? '', 'base64');

  if (
    primary.length !== MINISIGN_SIGNATURE_LENGTH ||
    primary.subarray(0, 2).toString('ascii') !== 'ED' ||
    !trustedCommentLine.startsWith(trustedCommentPrefix) ||
    globalSignature.length !== 64
  ) {
    throw new Error('Updater signature is not a supported prehashed Minisign signature.');
  }

  return {
    keyId: primary.subarray(2, 10),
    primary: primary.subarray(10),
    trustedComment: trustedCommentLine.slice(trustedCommentPrefix.length),
    global: globalSignature,
  };
};

const verifyMinisign = ({ bytes, encodedSignature, publicKey }) => {
  const signature = parseSignature(encodedSignature);

  if (!signature.keyId.equals(publicKey.keyId)) {
    throw new Error('Updater signature was created with a different key.');
  }

  const digest = createHash('blake2b512').update(bytes).digest();

  if (!verifyEd25519(null, digest, publicKey.key, signature.primary)) {
    throw new Error('Updater artifact signature verification failed.');
  }

  const globalPayload = Buffer.concat([
    signature.primary,
    Buffer.from(signature.trustedComment, 'utf8'),
  ]);

  if (!verifyEd25519(null, globalPayload, publicKey.key, signature.global)) {
    throw new Error('Updater signature trusted-comment verification failed.');
  }
};

const verifyInstallerFormat = (name, bytes) => {
  const normalizedName = name.toLowerCase();

  if (normalizedName.endsWith('.exe') && bytes.subarray(0, 2).equals(Buffer.from('MZ'))) {
    return;
  }

  const msiMagic = Buffer.from('d0cf11e0a1b11ae1', 'hex');
  if (normalizedName.endsWith('.msi') && bytes.subarray(0, msiMagic.length).equals(msiMagic)) {
    return;
  }

  throw new Error(`Updater asset ${name} does not match its installer format.`);
};

const parseExpectedVersion = (expectedVersion) => {
  const normalized = expectedVersion?.startsWith('v') ? expectedVersion.slice(1) : expectedVersion;

  if (!/^\d+\.\d+\.\d+$/.test(normalized ?? '')) {
    throw new Error(`Expected version must use X.Y.Z or vX.Y.Z format. Received: ${expectedVersion ?? '<unset>'}`);
  }

  return normalized;
};

const readManifest = async ({ expectedVersion, fetchImpl, manifestUrl }) => {
  const response = await fetchOk(fetchImpl, manifestUrl, undefined, 'Updater manifest');
  const manifest = await readJson(response, 'Updater manifest');

  if (manifest.version !== expectedVersion) {
    throw new RetryableUpdaterVerificationError(
      `Updater manifest version ${manifest.version ?? '<missing>'} does not match ${expectedVersion}.`,
    );
  }

  if (!manifest.platforms || typeof manifest.platforms !== 'object') {
    throw new Error('Updater manifest does not contain a platforms object.');
  }

  return manifest;
};

const collectWindowsArtifacts = (platforms) => {
  const artifacts = new Map();

  for (const platform of REQUIRED_WINDOWS_PLATFORMS) {
    if (!Object.hasOwn(platforms, platform)) {
      throw new Error(`Updater manifest is missing required platform ${platform}.`);
    }
  }

  for (const [platform, release] of Object.entries(platforms)) {
    if (!platform.startsWith(WINDOWS_PLATFORM_PREFIX)) continue;
    if (!release || typeof release.url !== 'string' || typeof release.signature !== 'string') {
      throw new Error(`Updater manifest platform ${platform} is incomplete.`);
    }

    const existing = artifacts.get(release.url);
    if (existing) {
      if (existing.signature !== release.signature) {
        throw new Error(`Updater manifest reuses ${release.url} with conflicting signatures.`);
      }

      existing.platforms.push(platform);
      continue;
    }

    artifacts.set(release.url, {
      platforms: [platform],
      signature: release.signature,
      url: release.url,
    });
  }

  if (artifacts.size === 0) {
    throw new Error('Updater manifest does not contain a Windows artifact.');
  }

  return [...artifacts.values()];
};

const verifyArtifact = async ({ artifact, fetchImpl, publicKey }) => {
  const metadataResponse = await fetchOk(fetchImpl, artifact.url, undefined, 'Updater asset metadata');
  const metadata = await readJson(metadataResponse, 'Updater asset metadata');

  if (
    metadata.state !== 'uploaded' ||
    typeof metadata.name !== 'string' ||
    !Number.isInteger(metadata.size) ||
    typeof metadata.digest !== 'string' ||
    !metadata.digest.startsWith('sha256:')
  ) {
    throw new Error(`Updater asset metadata for ${artifact.url} is incomplete.`);
  }

  const binaryResponse = await fetchOk(
    fetchImpl,
    artifact.url,
    {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': UPDATER_USER_AGENT,
      },
    },
    'Updater artifact',
  );
  const bytes = Buffer.from(await readBytes(binaryResponse, 'Updater artifact'));

  if (bytes.length !== metadata.size) {
    throw new Error(`Updater asset ${metadata.name} size mismatch: expected ${metadata.size}, received ${bytes.length}.`);
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expectedSha256 = metadata.digest.slice('sha256:'.length).toLowerCase();

  if (sha256 !== expectedSha256) {
    throw new Error(`Updater asset ${metadata.name} SHA-256 mismatch.`);
  }

  verifyInstallerFormat(metadata.name, bytes);
  verifyMinisign({ bytes, encodedSignature: artifact.signature, publicKey });

  return {
    name: metadata.name,
    platforms: artifact.platforms,
    bytes: bytes.length,
    sha256,
  };
};

const verifyPublishedUpdaterOnce = async ({
  expectedVersion,
  manifestUrl,
  publicKey: encodedPublicKey,
  fetchImpl = globalThis.fetch,
}) => {
  const version = parseExpectedVersion(expectedVersion);
  const manifest = await readManifest({ expectedVersion: version, fetchImpl, manifestUrl });
  const publicKey = parsePublicKey(encodedPublicKey);
  const artifacts = [];

  for (const artifact of collectWindowsArtifacts(manifest.platforms)) {
    artifacts.push(await verifyArtifact({ artifact, fetchImpl, publicKey }));
  }

  return { version, artifacts };
};

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export const verifyPublishedUpdater = async ({
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  ...options
}) => {
  let retryIndex = 0;

  while (true) {
    try {
      return await verifyPublishedUpdaterOnce(options);
    } catch (error) {
      if (
        !(error instanceof RetryableUpdaterVerificationError) ||
        retryIndex >= retryDelaysMs.length
      ) {
        throw error;
      }

      const delayMs = retryDelaysMs[retryIndex];
      retryIndex += 1;
      if (delayMs > 0) await wait(delayMs);
    }
  }
};

const runCli = async () => {
  const expectedVersion = process.argv[2] || process.env.GITHUB_REF_NAME;

  if (!expectedVersion) {
    throw new Error('Usage: node scripts/verify-published-updater.mjs <version-or-tag>');
  }

  const rootDir = process.cwd();
  const config = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  const manifestUrl = config.plugins?.updater?.endpoints?.[0];
  const publicKey = config.plugins?.updater?.pubkey;

  if (!manifestUrl || !publicKey) {
    throw new Error('Tauri updater endpoint and public key must be configured.');
  }

  const result = await verifyPublishedUpdater({
    expectedVersion,
    manifestUrl,
    publicKey,
  });

  const artifacts = result.artifacts
    .map(({ name, bytes }) => `${name} (${bytes} bytes)`)
    .join(', ');
  console.log(`Published updater verification passed for ${result.version}: ${artifacts}`);
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
