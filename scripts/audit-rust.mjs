import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ignoredAdvisories = new Map([
  [
    'RUSTSEC-2023-0071',
    {
      packageName: 'rsa',
      reason: 'optional rsa dependency through sqlx-mysql; Ambit beta only enables the local SQLite path',
    },
  ],
  [
    'RUSTSEC-2026-0235',
    {
      packageName: 'rkyv',
      reason: 'optional rkyv feature of rust_decimal is not enabled in Ambit\'s compiled dependency graph',
    },
  ],
]);

// Advisories on crates that ARE compiled, accepted only until `expiresOn` (UTC date) and only for
// the named package and version line. Any other finding, or this one after expiry, fails the audit.
export const timeLimitedExceptions = new Map([
  [
    'RUSTSEC-2026-0459',
    {
      packageName: 'libsqlite3-sys',
      versionPattern: /^0\.30\./,
      expiresOn: '2027-01-09',
      reason:
        'bundled SQLite < 3.54 WAL page-size leak (local, needs a crafted -wal); the patched libsqlite3-sys 0.39 ' +
        'is unreachable while sqlx 0.8/0.9 and tauri-plugin-sql 2.x cap it below 0.38; ' +
        'follow-up: https://github.com/AsuraAce/ambit/issues/365',
    },
  ],
]);

export const partitionFindings = (vulnerabilities, { today = new Date(), exceptions = timeLimitedExceptions } = {}) => {
  const blocking = [];
  const excepted = [];

  for (const finding of vulnerabilities) {
    const id = finding.advisory?.id;
    const pkg = finding.package ?? {};
    const exception = id ? exceptions.get(id) : undefined;
    const isCovered =
      exception !== undefined &&
      pkg.name === exception.packageName &&
      exception.versionPattern.test(pkg.version ?? '') &&
      today.getTime() < Date.parse(`${exception.expiresOn}T00:00:00Z`);

    (isCovered ? excepted : blocking).push(finding);
  }

  return { blocking, excepted };
};

const describeFinding = (finding) => {
  const advisory = finding.advisory ?? {};
  const pkg = finding.package ?? {};
  return `${advisory.id ?? 'unknown'} ${pkg.name ?? advisory.package ?? 'unknown'}@${pkg.version ?? 'unknown'}: ${advisory.title ?? 'untitled advisory'}`;
};

const runAudit = () => {
  for (const [id, { packageName }] of ignoredAdvisories) {
    const treeResult = spawnSync(
      'cargo',
      [
        'tree',
        '--locked',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--target',
        'x86_64-pc-windows-msvc',
        '--invert',
        packageName,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    if (treeResult.error || treeResult.status !== 0) {
      if (treeResult.stdout) {
        console.error(treeResult.stdout);
      }
      if (treeResult.stderr) {
        console.error(treeResult.stderr);
      }
      console.error(`Failed to verify that ignored advisory ${id} is outside the compiled dependency graph.`);
      process.exit(treeResult.status ?? 1);
    }

    if (treeResult.stdout.trim()) {
      console.error(`Ignored advisory ${id} is present in the compiled dependency graph:`);
      console.error(treeResult.stdout.trim());
      process.exit(1);
    }
  }

  const args = [
    'audit',
    '--file',
    'src-tauri/Cargo.lock',
    '--target-os',
    'windows',
    '--format',
    'json',
    ...[...ignoredAdvisories.keys()].flatMap((id) => ['--ignore', id]),
  ];

  const result = spawnSync('cargo', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    if (result.stdout) {
      console.error(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
    console.error(`Failed to parse cargo audit JSON output: ${error.message}`);
    process.exit(result.status ?? 1);
  }

  const vulnerabilities = report.vulnerabilities?.list ?? [];
  const { blocking, excepted } = partitionFindings(vulnerabilities);
  if (blocking.length > 0) {
    console.error(`Rust advisory audit failed: ${blocking.length} unignored vulnerability finding(s).`);

    for (const finding of blocking) {
      const id = finding.advisory?.id;
      const exception = id ? timeLimitedExceptions.get(id) : undefined;
      const note = exception ? ` (time-limited exception for ${exception.packageName} expired on ${exception.expiresOn} or does not cover this version)` : '';
      console.error(`- ${describeFinding(finding)}${note}`);
    }

    process.exit(1);
  }

  // cargo audit exits non-zero whenever it reports vulnerabilities, including excepted ones.
  if (result.status !== 0 && vulnerabilities.length === 0) {
    if (result.stderr) {
      console.error(result.stderr);
    }
    console.error(`cargo audit exited with status ${result.status}.`);
    process.exit(result.status);
  }

  const warnings = report.warnings ?? {};
  const warningEntries = Object.entries(warnings);
  const warningCount = warningEntries.reduce((total, [, items]) => total + items.length, 0);
  const warningSummary = warningEntries
    .filter(([, items]) => items.length > 0)
    .map(([kind, items]) => `${kind}: ${items.length}`)
    .join(', ');

  const dependencyCount = report.lockfile?.['dependency-count'] ?? 'unknown';
  console.log(`Rust advisory audit passed: 0 unignored vulnerabilities across ${dependencyCount} dependencies.`);
  console.log(
    `Ignored advisories: ${[...ignoredAdvisories.entries()]
      .map(([id, { reason }]) => `${id} (${reason})`)
      .join('; ')}`,
  );

  for (const finding of excepted) {
    const exception = timeLimitedExceptions.get(finding.advisory.id);
    console.warn(
      `Time-limited exception until ${exception.expiresOn}: ${describeFinding(finding)} (${exception.reason})`,
    );
  }

  if (warningCount > 0) {
    const packages = [
      ...new Set(
        warningEntries
          .flatMap(([, items]) => items)
          .map((item) => {
            const pkg = item.package ?? {};
            return `${pkg.name ?? item.advisory?.package ?? 'unknown'}@${pkg.version ?? 'unknown'}`;
          }),
      ),
    ];
    const shownPackages = packages.slice(0, 12).join(', ');
    const suffix = packages.length > 12 ? `, ... ${packages.length - 12} more` : '';

    console.warn(`Allowed cargo-audit warnings: ${warningCount}${warningSummary ? ` (${warningSummary})` : ''}.`);
    console.warn(`Warning packages: ${shownPackages}${suffix}.`);
  }
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  runAudit();
}
