// Supervises only already-compiled generated-data tests. Never launches Ambit.
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { realpathSync, readFileSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const PREFIX = 'AMBIT_OVERLAP_CONTROL ';
const ROUND_LIMIT = 60000;
const ROUND_COUNT = 96;
const OWNERSHIP_BUDGET_MS = 3600000;

function campaignExpired(start, budget, now) { return now - start >= budget; }

function requestWorkerTermination(worker, status) {
    if (worker.reason !== null || worker.finished) return false;
    worker.reason = status;
    worker.terminate();
    return true;
}

// A monotonic clock is supplied by the controller; tests use an injected clock.
class RoundDeadline {
    constructor(limit = ROUND_COUNT) { this.limit = limit; }
    next = 0;
    active = null;
    started = 0;
    accept(value, now) {
        if (!value || Object.keys(value).sort().join(',') !== 'kind,roundId'
            || !Number.isInteger(value.roundId) || value.roundId < 0 || value.roundId >= this.limit) return false;
        if (value.kind === 'overlap-round-start' && this.active === null && value.roundId === this.next) {
            this.active = value.roundId;
            this.started = now;
            return true;
        }
        if (value.kind === 'overlap-round-end' && this.active === value.roundId && !this.expired(now)) {
            this.active = null;
            this.next += 1;
            return true;
        }
        return false;
    }
    expired(now) { return this.active !== null && now - this.started >= ROUND_LIMIT; }
    complete() { return this.active === null && this.next === this.limit; }
}

function terminalStatus(text, byteLimit = 256 * 1024) {
    if (Buffer.byteLength(text) > byteLimit) return 'incomplete';
    try {
        const records = text.trim().split('\n').map(line => JSON.parse(line));
        if (records[0]?.kind !== 'header' || records.filter(row => row.kind === 'header').length !== 1) return 'incomplete';
        if (records.some((row, index) => row.sequence !== index)) return 'incomplete';
        if (records.filter(row => row.kind === 'terminal').length !== 1) return 'incomplete';
        const last = records.at(-1);
        const allowed = ['completed', 'overhead-gate-failed', 'timed-out', 'query-failed', 'result-mismatch',
            'incomplete-trace', 'invalid-comparison', 'failed', 'interrupted',
            'invalid-generated-fixture', 'fixture-copy-failed', 'fixture-setup-failed',
            'bypass-install-failed', 'bypass-column-mismatch', 'fixture-content-mismatch', 'incomplete-rounds'];
        return last.kind === 'terminal' && allowed.includes(last.status) ? last.status : 'incomplete';
    } catch { return 'incomplete'; }
}

function validTemplateEvidence(records) {
    const header = records[0];
    const order = [0, 1, 5, 2, 4, 3];
    const conditions = ['local-shipping', 'local-bypass', 'invoke-all-shipping', 'invoke-all-bypass',
        'invoke-selected-shipping', 'invoke-selected-bypass'];
    if (header.preparationDiagnosticsVersion !== 1
        || header.fixturePolicy !== 'prepared-once-per-condition-v1' || header.templateCount !== 6
        || header.maxLiveCatalogs !== 8 || JSON.stringify(header.templatePreparationOrder) !== JSON.stringify(order)) return false;
    const templates = new Map();
    let admissions = 0;
    for (const row of records.slice(1)) {
        if (row.kind === 'template-prepared' || row.kind === 'fixture') {
            const index = row.templateIndex;
            if (!Number.isInteger(index) || index < 0 || index >= 6 || row.condition !== conditions[index]
                || row.exactResultEqual !== true || !Number.isSafeInteger(row.bytes) || row.bytes < 0
                || !Number.isSafeInteger(row.sourceRows) || row.sourceRows < 0) return false;
            if (row.kind === 'template-prepared') {
                if (admissions !== 0 || templates.has(index) || index !== order[templates.size]) return false;
                templates.set(index, row);
            } else {
                const block = Math.floor(admissions / 6);
                const expected = (order[admissions % 6] + block) % 6;
                const template = templates.get(index);
                if (templates.size !== 6 || admissions >= 36 || row.block !== block || index !== expected
                    || row.templateReused !== (block > 0) || row.bytes !== template.bytes
                    || row.sourceRows !== template.sourceRows) return false;
                admissions += 1;
            }
        } else if (['pool', 'ipc', 'native', 'overlap', 'native-group-span'].includes(row.kind)) {
            if (templates.size !== 6 || admissions === 0) return false;
        }
    }
    return templates.size === 6 && admissions === 36;
}

function terminalEvidence(text, byteLimit = 256 * 1024) {
    const status = terminalStatus(text, byteLimit);
    if (status === 'incomplete') return { status };
    const terminal = JSON.parse(text.trim().split('\n').at(-1));
    const header = JSON.parse(text.trim().split('\n')[0]);
    const preparationProtocol = Object.hasOwn(header, 'preparationDiagnosticsVersion');
    if (preparationProtocol && header.preparationDiagnosticsVersion !== 1) return { status: 'incomplete' };
    const evidence = { status };
    if (preparationProtocol || Object.hasOwn(terminal, 'preparationFailure')
        || Object.hasOwn(terminal, 'droppedRecords') || Object.hasOwn(terminal, 'storageUnavailable')) {
        if (!Number.isSafeInteger(terminal.droppedRecords) || terminal.droppedRecords < 0
            || typeof terminal.storageUnavailable !== 'boolean') return { status: 'incomplete' };
        evidence.droppedRecords = terminal.droppedRecords;
        evidence.storageUnavailable = terminal.storageUnavailable;
        evidence.evidenceIncomplete = terminal.droppedRecords !== 0 || terminal.storageUnavailable;
    }
    const records = text.trim().split('\n').map(line => JSON.parse(line));
    if (['fixturePolicy', 'templateCount', 'templatePreparationOrder', 'maxLiveCatalogs']
        .some(key => Object.hasOwn(header, key))
        || records.some(row => row.kind === 'template-prepared'
            || (row.kind === 'fixture' && ['templateIndex', 'templateReused'].some(key => Object.hasOwn(row, key))))) {
        if (!validTemplateEvidence(records)) {
            evidence.evidenceIncomplete = true;
            if (status === 'completed') return { ...evidence, status: 'incomplete' };
        }
    }
    if (!Object.hasOwn(terminal, 'preparationFailure')) return evidence;
    const value = terminal.preparationFailure;
    const stages = ['directory-creation', 'fixture-generation', 'fixture-copy', 'connection-opening',
        'ownership-assignment', 'scope-setup', 'fixture-validation', 'bypass-installation',
        'analysis', 'checkpointing', 'equality-check', 'file-size-inspection'];
    const conditions = ['local-shipping', 'local-bypass', 'invoke-all-shipping', 'invoke-all-bypass',
        'invoke-selected-shipping', 'invoke-selected-bypass'];
    const keys = ['stage', 'condition', 'block', 'elapsedMs', 'category', 'sqliteCode', 'osCode'];
    const i32 = number => Number.isInteger(number) && number >= -2147483648 && number <= 2147483647;
    if (status === 'completed' || !value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !keys.includes(key))
        || !stages.includes(value.stage) || !['sqlite', 'os', 'validation', 'unknown'].includes(value.category)
        || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0
        || Object.hasOwn(value, 'condition') !== Object.hasOwn(value, 'block')
        || (Object.hasOwn(value, 'condition') && !conditions.includes(value.condition))
        || (Object.hasOwn(value, 'block') && (!Number.isInteger(value.block) || value.block < 0 || value.block > 5))
        || (Object.hasOwn(value, 'sqliteCode') && (value.category !== 'sqlite' || !i32(value.sqliteCode)))
        || (Object.hasOwn(value, 'osCode') && (value.category !== 'os' || !i32(value.osCode)))) {
        return { status: 'incomplete' };
    }
    // Only the validated fixed-shape detail is propagated; no arbitrary child record or stderr.
    return { ...evidence, preparationFailure: value };
}

function selfTest() {
    const templateOrder = [0, 1, 5, 2, 4, 3];
    const templateConditions = ['local-shipping', 'local-bypass', 'invoke-all-shipping', 'invoke-all-bypass',
        'invoke-selected-shipping', 'invoke-selected-bypass'];
    const templateHeader = { kind: 'header', preparationDiagnosticsVersion: 1,
        fixturePolicy: 'prepared-once-per-condition-v1', templateCount: 6,
        templatePreparationOrder: templateOrder, maxLiveCatalogs: 8 };
    const templateRows = templateOrder.map(templateIndex => ({ kind: 'template-prepared', templateIndex,
        condition: templateConditions[templateIndex], bytes: 123, sourceRows: 10, exactResultEqual: true }));
    const fixtureRows = Array.from({ length: 6 }, (_, block) => templateOrder.map(value => {
        const templateIndex = (value + block) % 6;
        return { kind: 'fixture', templateIndex, condition: templateConditions[templateIndex], block,
            templateReused: block > 0, bytes: 123, sourceRows: 10, exactResultEqual: true };
    })).flat();
    const templateReport = (rows, header = templateHeader, status = 'completed', detail = {}) =>
        [header, ...rows, { kind: 'terminal', status, droppedRecords: 0, storageUnavailable: false, ...detail }]
            .map((row, sequence) => JSON.stringify({ ...row, sequence })).join('\n') + '\n';
    assert.equal(terminalEvidence(templateReport([...templateRows, ...fixtureRows])).status, 'completed');
    assert.equal(terminalEvidence(templateReport([...templateRows.slice(1), ...fixtureRows])).status, 'incomplete');
    assert.equal(terminalEvidence(templateReport([...templateRows, ...fixtureRows], { kind: 'header' })).status, 'incomplete');
    for (const rows of [
        [...templateRows, templateRows[0], ...fixtureRows],
        [templateRows[1], templateRows[0], ...templateRows.slice(2), ...fixtureRows],
        [...templateRows, ...fixtureRows.slice(1)],
        [...templateRows, ...fixtureRows, fixtureRows[0]],
        [...templateRows, ...fixtureRows.map((row, i) => i === 6 ? { ...row, templateReused: false } : row)],
        [...templateRows, ...fixtureRows.map((row, i) => i === 0 ? { ...row, templateIndex: 3 } : row)],
        [...templateRows, ...fixtureRows.map((row, i) => i === 0 ? { ...row, bytes: 124 } : row)],
        [...templateRows, ...fixtureRows.map((row, i) => i === 0 ? { ...row, exactResultEqual: false } : row)],
        [{ kind: 'ipc' }, ...templateRows, ...fixtureRows],
    ]) assert.equal(terminalEvidence(templateReport(rows)).status, 'incomplete');
    for (const header of [{ ...templateHeader, fixturePolicy: 'PRIVATE_SENTINEL' },
        { ...templateHeader, preparationDiagnosticsVersion: undefined },
        { ...templateHeader, templateCount: 5 }, { ...templateHeader, maxLiveCatalogs: 9 },
        { ...templateHeader, templatePreparationOrder: [0, 1, 2, 3, 4, 5] }]) {
        const evidence = terminalEvidence(templateReport([...templateRows, ...fixtureRows], header));
        assert.equal(evidence.status, 'incomplete');
        assert.equal(JSON.stringify(evidence).includes('PRIVATE_SENTINEL'), false);
    }
    for (const change of [{ templateIndex: -1 }, { templateIndex: 0.5 }, { condition: 'PRIVATE_SENTINEL' },
        { bytes: -1 }, { bytes: Infinity }, { sourceRows: '10' }, { sourceRows: 1.5 },
        { exactResultEqual: false }]) {
        const rows = [{ ...templateRows[0], ...change }, ...templateRows.slice(1), ...fixtureRows];
        const evidence = terminalEvidence(templateReport(rows));
        assert.equal(evidence.status, 'incomplete');
        assert.equal(JSON.stringify(evidence).includes('PRIVATE_SENTINEL'), false);
    }
    assert.equal(terminalEvidence(templateReport(templateRows.slice(0, 2), templateHeader, 'interrupted')).status, 'interrupted');
    const failedTemplate = { stage: 'fixture-validation', condition: 'invoke-selected-bypass', block: 0,
        elapsedMs: 10, category: 'validation' };
    const partialTemplateFailure = terminalEvidence(templateReport(templateRows.slice(0, 2), templateHeader,
        'fixture-setup-failed', { preparationFailure: failedTemplate }));
    assert.equal(partialTemplateFailure.status, 'fixture-setup-failed');
    assert.equal(partialTemplateFailure.evidenceIncomplete, true);
    assert.deepEqual(partialTemplateFailure.preparationFailure, failedTemplate);
    const droppedTemplateFailure = terminalEvidence(templateReport([templateRows[1]], templateHeader,
        'fixture-setup-failed', { preparationFailure: failedTemplate, droppedRecords: 1 }));
    assert.equal(droppedTemplateFailure.status, 'fixture-setup-failed');
    assert.equal(droppedTemplateFailure.evidenceIncomplete, true);
    assert.deepEqual(droppedTemplateFailure.preparationFailure, failedTemplate);
    const setupFailure = { stage: 'ownership-assignment', condition: 'invoke-all-shipping', block: 0,
        elapsedMs: 12, category: 'sqlite', sqliteCode: 13 };
    const setupReport = (failure, fields = { droppedRecords: 0, storageUnavailable: false }) => `${JSON.stringify({ kind: 'header', sequence: 0 })}\n${JSON.stringify({ kind: 'terminal', sequence: 1, status: 'fixture-setup-failed', preparationFailure: failure, ...fields })}\n`;
    assert.deepEqual(terminalEvidence(setupReport(setupFailure)).preparationFailure, setupFailure);
    const openFailure = { stage: 'connection-opening', elapsedMs: 1, category: 'os', osCode: 5 };
    assert.deepEqual(terminalEvidence(setupReport(openFailure)).preparationFailure, openFailure);
    assert.deepEqual(terminalEvidence(setupReport(setupFailure, { droppedRecords: 1, storageUnavailable: false })), {
        status: 'fixture-setup-failed', preparationFailure: setupFailure, droppedRecords: 1,
        storageUnavailable: false, evidenceIncomplete: true,
    });
    assert.equal(terminalEvidence(setupReport(setupFailure, { droppedRecords: 0, storageUnavailable: false })).evidenceIncomplete, false);
    assert.equal(terminalEvidence(setupReport(setupFailure, { droppedRecords: 0, storageUnavailable: true })).evidenceIncomplete, true);
    for (const fields of [{}, { droppedRecords: 1 }, { storageUnavailable: true },
        { droppedRecords: -1, storageUnavailable: false }, { droppedRecords: 0, storageUnavailable: 'PRIVATE_SENTINEL' }]) {
        assert.deepEqual(terminalEvidence(setupReport(setupFailure, fields)), { status: 'incomplete' });
    }
    const legacyReport = '{"kind":"header","sequence":0}\n{"kind":"terminal","sequence":1,"status":"completed"}\n';
    assert.deepEqual(terminalEvidence(legacyReport), { status: 'completed' });
    assert.deepEqual(terminalEvidence(legacyReport.replace('"kind":"header"', '"kind":"header","preparationDiagnosticsVersion":1')), { status: 'incomplete' });
    for (const category of ['validation', 'unknown']) {
        const value = { stage: 'fixture-validation', elapsedMs: 0, category };
        assert.deepEqual(terminalEvidence(setupReport(value)).preparationFailure, value);
    }
    for (const value of [null, [], {}, { ...setupFailure, message: 'PRIVATE_SENTINEL' },
        { ...setupFailure, stage: 'PRIVATE_SENTINEL' }, { ...setupFailure, condition: 'PRIVATE_SENTINEL' },
        { ...setupFailure, category: 'PRIVATE_SENTINEL' }, { ...setupFailure, block: 6 },
        { ...setupFailure, block: 0.5 }, { ...setupFailure, elapsedMs: -1 },
        { ...setupFailure, elapsedMs: Infinity }, { ...setupFailure, sqliteCode: 2147483648 },
        { ...setupFailure, sqliteCode: '13' }, { ...setupFailure, osCode: 5 }]) {
        const evidence = terminalEvidence(setupReport(value));
        assert.deepEqual(evidence, { status: 'incomplete' });
        assert.equal(JSON.stringify(evidence).includes('PRIVATE_SENTINEL'), false);
    }
    assert.deepEqual(terminalEvidence(setupReport(setupFailure).replace('fixture-setup-failed', 'completed')), { status: 'incomplete' });
    assert.deepEqual(terminalEvidence(setupReport(setupFailure) + '{'), { status: 'incomplete' });
    assert.deepEqual(terminalEvidence(setupReport(setupFailure) + setupReport(openFailure)), { status: 'incomplete' });
    assert.deepEqual(terminalEvidence(setupReport(setupFailure), 16), { status: 'incomplete' });
    const { condition: omittedCondition, ...orphanBlock } = setupFailure;
    const { block: omittedBlock, ...orphanCondition } = setupFailure;
    assert.equal(omittedCondition, 'invoke-all-shipping');
    assert.equal(omittedBlock, 0);
    assert.deepEqual(terminalEvidence(setupReport(orphanBlock)), { status: 'incomplete' });
    assert.deepEqual(terminalEvidence(setupReport(orphanCondition)), { status: 'incomplete' });
    const clock = new RoundDeadline();
    assert.equal(clock.accept({ kind: 'overlap-round-end', roundId: 0 }, 0), false);
    assert.equal(clock.accept({ kind: 'overlap-round-start', roundId: 1 }, 0), false);
    assert.equal(clock.accept({ kind: 'overlap-round-start', roundId: 0, secret: 'ignored' }, 0), false);
    assert.equal(clock.accept({ kind: 'overlap-round-start', roundId: 0 }, 10), true);
    assert.equal(clock.accept({ kind: 'overlap-round-start', roundId: 0 }, 11), false);
    assert.equal(clock.expired(60009), false);
    assert.equal(clock.expired(60010), true);
    assert.equal(clock.accept({ kind: 'overlap-round-end', roundId: 0 }, 60010), false);
    assert.equal(ROUND_LIMIT, 60000);
    assert.equal(campaignExpired(10, OWNERSHIP_BUDGET_MS, 10 + OWNERSHIP_BUDGET_MS - 1), false);
    assert.equal(campaignExpired(10, OWNERSHIP_BUDGET_MS, 10 + OWNERSHIP_BUDGET_MS), true);
    const worker = { reason: null, finished: false, terminated: 0,
        terminate() { this.terminated += 1; } };
    assert.equal(requestWorkerTermination(worker, 'timed-out'), true);
    assert.equal(worker.reason, 'timed-out');
    assert.equal(worker.terminated, 1);
    assert.equal(requestWorkerTermination(worker, 'interrupted'), false);
    assert.equal(worker.terminated, 1);
    assert.equal(requestWorkerTermination({ reason: null, finished: true, terminate() { assert.fail('finished worker must not terminate'); } }, 'timed-out'), false);
    const good = new RoundDeadline();
    for (let n = 0; n < ROUND_COUNT; n++) {
        assert.equal(good.accept({ kind: 'overlap-round-start', roundId: n }, n * 10), true);
        assert.equal(good.accept({ kind: 'overlap-round-end', roundId: n }, n * 10 + 1), true);
    }
    assert.equal(good.complete(), true);
    const qualification = new RoundDeadline(8);
    assert.equal(qualification.accept({ kind: 'overlap-round-start', roundId: 8 }, 0), false);
    for (let n = 0; n < 8; n++) {
        assert.equal(qualification.accept({ kind: 'overlap-round-start', roundId: n }, n * 10), true);
        assert.equal(qualification.accept({ kind: 'overlap-round-end', roundId: n }, n * 10 + 1), true);
    }
    assert.equal(qualification.complete(), true);
    const ownership = new RoundDeadline(288);
    for (let n = 0; n < 288; n++) {
        assert.equal(ownership.accept({ kind: 'overlap-round-start', roundId: n }, n * 10), true);
        assert.equal(ownership.accept({ kind: 'overlap-round-end', roundId: n }, n * 10 + 1), true);
    }
    assert.equal(ownership.complete(), true);
    assert.equal(ownership.accept({ kind: 'overlap-round-start', roundId: 288 }, 3000), false);
    const largeReport = `${JSON.stringify({ kind: 'header', sequence: 0, padding: 'x'.repeat(300 * 1024) })}\n{"kind":"terminal","sequence":1,"status":"completed"}\n`;
    assert.equal(terminalStatus(largeReport), 'incomplete');
    assert.equal(terminalStatus(largeReport, 1024 * 1024), 'completed');
    assert.equal(terminalStatus('x'.repeat(1024 * 1024 + 1), 1024 * 1024), 'incomplete');
    assert.equal(clock.complete(), false);
    assert.equal(terminalStatus('{"kind":"header","sequence":0}\n{"kind":"terminal","sequence":1,"status":"completed"}\n'), 'completed');
    for (const text of ['', '{', '{"kind":"terminal","sequence":1,"status":"completed"}',
        '{"kind":"terminal","sequence":0,"status":"completed"}\n{"kind":"terminal","sequence":1,"status":"completed"}',
        '{"kind":"header","sequence":0}', 'x'.repeat(256 * 1024 + 1)]) assert.equal(terminalStatus(text), 'incomplete');
    assert.equal(terminalStatus('{"kind":"terminal","sequence":0,"status":"completed"}'), 'incomplete');
    assert.equal(terminalStatus('{"kind":"header","sequence":0}\n{"kind":"terminal","sequence":1,"status":"interrupted"}'), 'interrupted');
    assert.equal(terminalStatus('{"kind":"header","sequence":0}\n{"kind":"terminal","sequence":1,"status":"invalid-generated-fixture"}'), 'invalid-generated-fixture');
    for (const status of ['bypass-column-mismatch', 'fixture-content-mismatch']) {
        assert.equal(terminalStatus(`{"kind":"header","sequence":0}\n${JSON.stringify({ kind: 'terminal', sequence: 1, status })}`), status);
    }
    console.info('Generated SQL controller deadline/evidence tests passed.');
}

function run() {
    const ownership = process.argv[2] === '--ownership';
    const uniform = process.argv[2] === '--overlap-defaults';
    const overlap = process.argv[2] === '--overlap' || uniform;
    const qualification = process.argv[2] === '--qualify';
    const roundSupervision = overlap || qualification || ownership;
    const root = fileURLToPath(new URL('../', import.meta.url));
    const deps = realpathSync(resolve(root, 'src-tauri/target/debug/deps'));
    const executable = realpathSync(process.argv[roundSupervision ? 3 : 2] ?? '');
    if (dirname(executable).toLowerCase() !== deps.toLowerCase() || !/^app_lib-[a-f0-9]+\.exe$/.test(basename(executable))) {
        throw new Error('Only the generated-test executable is allowed');
    }
    const id = randomUUID();
    const campaign = ownership ? 'ownership' : uniform ? 'uniform-overlap' : overlap ? 'overlap' : qualification ? 'qualification' : 'overhead';
    const budget = ownership ? OWNERSHIP_BUDGET_MS : overlap ? 1800000 : 1200000;
    const byteLimit = ownership ? 1024 * 1024 : 256 * 1024;
    const reportPath = join(root, `src-tauri/target/startup-sql-${campaign}-${id}.jsonl`);
    const file = openSync(join(root, `src-tauri/target/startup-sql-${campaign}-${id}-controller.jsonl`), 'wx');
    const start = performance.now();
    let sequence = 0;
    const record = value => writeSync(file, `${JSON.stringify({ ...value, sequence: sequence++ })}\n`);
    record({ kind: 'header', schema: 2, evidenceId: id, executableHash: createHash('sha256').update(readFileSync(executable)).digest('hex'),
        budgetMs: budget, roundDeadlineMs: roundSupervision ? ROUND_LIMIT : null,
        ...(ownership ? { expectedRounds: 288, reportByteLimit: byteLimit } : {}) });
    const test = ownership ? 'measure_startup_sql_ownership_once' : uniform ? 'measure_startup_sql_uniform_overlap_once' : overlap ? 'measure_startup_sql_overlap_once' : qualification ? 'overlap_generated_arm_evidence_smoke' : 'measure_startup_sql_trace_overhead_once';
    const child = spawn(executable, [`db::migrations::sql_plugin_tests::count_index_benchmark::startup_sql_overhead::${test}`, '--exact', '--ignored', '--nocapture', '--test-threads=1'], {
        cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env,
            ...(ownership ? { AMBIT_SQL_TRACE_OWNERSHIP: '1', AMBIT_SQL_TRACE_OWNERSHIP_ID: id }
                : uniform ? { AMBIT_SQL_TRACE_UNIFORM_OVERLAP: '1', AMBIT_SQL_TRACE_UNIFORM_OVERLAP_ID: id }
                : qualification ? { AMBIT_SQL_TRACE_QUALIFICATION_ID: id }
                : overlap ? { AMBIT_SQL_TRACE_OVERLAP: '1', AMBIT_SQL_TRACE_OVERLAP_ID: id }
                : { AMBIT_SQL_TRACE_OVERHEAD: '1', AMBIT_SQL_TRACE_OVERHEAD_ID: id }),
            PATH: `${deps};${process.env.PATH ?? ''}` },
    });
    const rounds = new RoundDeadline(ownership ? 288 : qualification ? 8 : ROUND_COUNT);
    const worker = { reason: null, finished: false, terminate: () => child.kill() };
    let line = '';
    let discarding = false;
    const stop = status => {
        // Only the child handle created above is eligible for termination.
        requestWorkerTermination(worker, status);
    };
    const interrupt = () => stop('interrupted');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const tick = () => {
        const now = performance.now();
        if (campaignExpired(start, budget, now)) stop('timed-out');
        else if (roundSupervision && rounds.expired(now)) stop('round-timed-out');
    };
    const timer = setInterval(tick, 25);
    child.stdout.on('data', chunk => {
        if (!roundSupervision || worker.reason) return;
        // Bounded line buffering; arbitrary test output is discarded, never retained in evidence.
        for (const character of chunk.toString('utf8')) {
            if (character === '\n') {
                if (!discarding) {
                    const at = line.indexOf(PREFIX);
                    if (at >= 0) {
                        let event;
                        try { event = JSON.parse(line.slice(at + PREFIX.length)); } catch { stop('invalid-control'); }
                        tick();
                        if (!worker.reason && !rounds.accept(event, performance.now())) stop('invalid-control');
                    }
                }
                line = ''; discarding = false;
            } else if (!discarding) {
                if (line.length >= 4096) { line = ''; discarding = true; }
                else line += character;
            }
        }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => { worker.reason ??= 'worker-unavailable'; });
    child.on('close', code => {
        if (worker.finished) return;
        worker.finished = true;
        clearInterval(timer);
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        let childEvidence = { status: 'incomplete' };
        try {
            if (statSync(reportPath).size <= byteLimit) childEvidence = terminalEvidence(readFileSync(reportPath, 'utf8'), byteLimit);
        } catch { /* Missing/partial evidence is never success. */ }
        const childStatus = childEvidence.status;
        const status = worker.reason ?? (code === 0 && childStatus === 'completed' && !childEvidence.evidenceIncomplete && (!roundSupervision || rounds.complete()) ? 'completed' : 'failed');
        record({ kind: 'terminal', status, childStatus, elapsedMs: performance.now() - start,
            ...(childEvidence.preparationFailure ? { preparationFailure: childEvidence.preparationFailure } : {}),
            ...(Object.hasOwn(childEvidence, 'evidenceIncomplete') ? {
                evidenceIncomplete: childEvidence.evidenceIncomplete, droppedRecords: childEvidence.droppedRecords,
                storageUnavailable: childEvidence.storageUnavailable,
            } : {}),
            completedRounds: roundSupervision ? rounds.next : null, pendingRound: roundSupervision ? rounds.active : null,
            generatedWorkerTerminationRequested: worker.reason !== null && worker.reason !== 'worker-unavailable' });
        closeSync(file);
        console.info(`SQL ${campaign} campaign ${id}: ${status} (${childStatus}).`);
        process.exitCode = status === 'completed' ? 0 : 1;
    });
}

if (process.argv[2] === '--self-test') selfTest();
else run();
