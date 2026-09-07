import { describe, expect, it, vi } from 'vitest';
import { createStartupRepairCollector } from '../startupRepairDiagnostics';
import { createStartupDiagnosticBridge } from '../startupDiagnostics';
import type { StartupRepairDecision } from '../../bindings';

const decision: StartupRepairDecision = {
    decision: 'full-repair', scope: 'all', forcedRefresh: false, snapshot: 'missing',
    savedFingerprint: 'unavailable', currentFingerprint: 'supported',
    countComparison: 'unavailable', timestampComparison: 'unavailable', fingerprintCurrent: false,
};

describe('startup repair aggregate evidence', () => {
    it('aggregates repeated calls and excludes nested enumeration from elapsed accounting', () => {
        let now = 0;
        const report = vi.fn();
        const stage = vi.fn();
        const collector = createStartupRepairCollector({ now: () => now, report, stage });
        collector.stage('identity');
        collector.stage('identity');
        const paths = collector.start('identity-paths');
        now = 2;
        const enumeration = collector.start('filesystem-enumeration');
        now = 7;
        enumeration();
        now = 10;
        paths();
        const next = collector.start('identity-paths');
        now = 14;
        next();
        collector.count('identityRows', 1000);
        now = 20;
        collector.finish('completed');
        collector.finish('failed');
        expect(stage).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toMatchObject({
            durationMs: 20, unattributedMs: 6, status: 'completed', counters: { identityRows: 1000 },
            metrics: expect.arrayContaining([
                { operation: 'identity-paths', calls: 2, totalMs: 14, maxMs: 10 },
                { operation: 'filesystem-enumeration', calls: 1, totalMs: 5, maxMs: 5 },
            ]),
        });
        expect(report.mock.calls[0][0].metrics).toHaveLength(14);
    });

    it('retains the interrupted operation and contains diagnostic sink/clock errors', () => {
        let now = 0;
        const report = vi.fn();
        const collector = createStartupRepairCollector({ now: () => now, report, stage: () => { throw Error('private'); } });
        collector.stage('facts');
        collector.start('fact-write');
        now = 17;
        collector.finish('cancelled');
        expect(report.mock.calls[0][0]).toMatchObject({ status: 'cancelled', durationMs: 17,
            metrics: expect.arrayContaining([{ operation: 'fact-write', calls: 1, totalMs: 17, maxMs: 17 }]) });
        const unavailable = createStartupRepairCollector({
            now: () => { throw Error('clock'); }, report: () => { throw Error('disk'); }, stage: () => undefined,
        });
        expect(() => { unavailable.start('setup')(); unavailable.finish('failed'); }).not.toThrow();
    });

    it('reserves one decision and repair across preconnect saturation and readiness', async () => {
        const send = vi.fn();
        const bridge = createStartupDiagnosticBridge({ now: () => 0, send,
            getLaunch: async () => ({ launchId: 'ab', processElapsedMs: 0 }), maxBufferedEvents: 1 });
        bridge.mark('facets');
        bridge.repairDecision(decision);
        bridge.repairDecision({ ...decision, decision: 'unchanged' });
        const collector = bridge.claimRepair()!;
        expect(bridge.claimRepair()).toBeUndefined();
        for (let index = 0; index < 1000; index++) collector.stage('facts');
        bridge.mark('ready');
        collector.finish('completed');
        await bridge.connect();
        const phases = send.mock.calls.map(([event]) => event.phase);
        expect(phases).toEqual(['ready', 'owner-repair-decision', 'owner-repair-stage', 'owner-repair-report']);
        expect(bridge.claimRepair()).toBeUndefined();
        expect(send.mock.calls[1][0].repairDecision).toEqual(decision);
    });

    it('does not duplicate a repair sent by a launch subscriber and contains transport rejection', async () => {
        const send = vi.fn(() => Promise.reject(Error('private transport')));
        const bridge = createStartupDiagnosticBridge({ now: () => 0, send,
            getLaunch: async () => ({ launchId: 'ab', processElapsedMs: 0 }) });
        bridge.subscribe(() => bridge.repairDecision(decision));
        await bridge.connect();
        expect(send).toHaveBeenCalledTimes(1);
        bridge.claimRepair()!.finish('failed');
        await Promise.resolve();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('does not claim runtime repair after startup failure, or fabricate timing after clock failure', () => {
        const bridge = createStartupDiagnosticBridge({ now: () => 0, send: vi.fn(),
            getLaunch: async () => ({ launchId: 'ab', processElapsedMs: 0 }) });
        bridge.fail('startup-failure', 'render-error');
        expect(bridge.claimRepair()).toBeUndefined();
        const report = vi.fn();
        const collector = createStartupRepairCollector({ now: () => Number.NaN, stage: vi.fn(), report });
        collector.finish('completed');
        expect(report).not.toHaveBeenCalled();
    });
});
