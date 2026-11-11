import assert from 'node:assert/strict';
import test from 'node:test';

import { isExpectedAuditExit, partitionFindings, timeLimitedExceptions } from './audit-rust.mjs';

const finding = (id, name, version) => ({ advisory: { id, title: `${id} title` }, package: { name, version } });

const BEFORE_EXPIRY = new Date('2026-11-10T12:00:00Z');
const ON_EXPIRY = new Date('2027-01-09T00:00:00Z');

test('the bundled-SQLite exception covers only RUSTSEC-2026-0459 on libsqlite3-sys 0.30.x before it expires', () => {
    const covered = finding('RUSTSEC-2026-0459', 'libsqlite3-sys', '0.30.1');

    assert.deepEqual(partitionFindings([covered], { today: BEFORE_EXPIRY }), { blocking: [], excepted: [covered] });
});

test('the exception stops applying on its expiry date so the audit fails again', () => {
    const covered = finding('RUSTSEC-2026-0459', 'libsqlite3-sys', '0.30.1');

    assert.deepEqual(partitionFindings([covered], { today: ON_EXPIRY }), { blocking: [covered], excepted: [] });
});

test('a new advisory against libsqlite3-sys still fails the audit', () => {
    const unrelated = finding('RUSTSEC-2026-9999', 'libsqlite3-sys', '0.30.1');

    assert.deepEqual(partitionFindings([unrelated], { today: BEFORE_EXPIRY }).blocking, [unrelated]);
});

test('the exception does not cover another version line or another package', () => {
    const otherLine = finding('RUSTSEC-2026-0459', 'libsqlite3-sys', '0.31.0');
    const otherPackage = finding('RUSTSEC-2026-0459', 'libsqlite3-src', '0.30.1');

    assert.deepEqual(partitionFindings([otherLine, otherPackage], { today: BEFORE_EXPIRY }).blocking, [otherLine, otherPackage]);
});

test('a non-zero cargo audit exit passes only when every listed finding is a covered exception', () => {
    const covered = finding('RUSTSEC-2026-0459', 'libsqlite3-sys', '0.30.1');
    const unrelated = finding('RUSTSEC-2026-9999', 'libsqlite3-sys', '0.30.1');
    const outcome = (findings) => partitionFindings(findings, { today: BEFORE_EXPIRY });

    assert.equal(isExpectedAuditExit(1, { vulnerabilities: [covered], ...outcome([covered]) }), true);
    assert.equal(isExpectedAuditExit(1, { vulnerabilities: [], ...outcome([]) }), false);
    assert.equal(isExpectedAuditExit(1, { vulnerabilities: [covered, unrelated], ...outcome([covered, unrelated]) }), false);
});

test('every time-limited exception names its follow-up issue and a valid expiry date', () => {
    for (const [id, exception] of timeLimitedExceptions) {
        assert.match(exception.reason, /https:\/\/github\.com\/AsuraAce\/ambit\/issues\/\d+/, `${id} reason links an issue`);
        assert.ok(!Number.isNaN(Date.parse(`${exception.expiresOn}T00:00:00Z`)), `${id} has a parseable expiry`);
    }
});
