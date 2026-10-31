import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInvokeSyncTrace } from '../invokeSyncTrace';
import type { InvokeOperationState } from '../../stores/invokeOwnerScopeStore';

const operation = (id: symbol, phase: InvokeOperationState['phase'] = 'syncing'): InvokeOperationState => ({
    id, origin: 'user', rootPath: 'C:/secret/owner', targetLabel: 'private image.jpg', phase,
    viewCommitted: true, progress: { current: 0, total: 5, message: 'C:/secret/raw-progress' },
    message: 'private failure details',
});

const setup = (overrides: Partial<Parameters<typeof createInvokeSyncTrace>[0]> = {}) => {
    const writes: Array<{ fileName: string; content: string }> = [];
    const write = vi.fn(async (fileName: string, content: string) => {
        writes.push({ fileName, content });
    });
    const trace = createInvokeSyncTrace({
        enabled: true,
        now: () => Date.now(),
        setTimeout: (callback, delay) => setTimeout(callback, delay),
        clearTimeout: timer => clearTimeout(timer),
        documentVisible: () => true,
        runId: () => 'opaque-test-run',
        write,
        ...overrides,
    });
    return { trace, writes, write };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('InvokeAI opt-in sync trace', () => {
    it('does no diagnostic work when disabled and still runs measured work once', async () => {
        const write = vi.fn();
        const timer = vi.fn();
        const sampleHealth = vi.fn();
        const trace = createInvokeSyncTrace({ enabled: false, write, setTimeout: timer, sampleHealth });
        const work = vi.fn(async () => 42);
        trace.observeOperation(operation(Symbol('secret')));
        trace.serviceProgress(undefined, 1, 2);
        trace.presentationCommitted(undefined, true, false);
        expect(trace.claimRepair(Symbol())).toBeUndefined();
        expect(await trace.measure(undefined, 'image-sync', work)).toBe(42);
        trace.dispose();
        expect(trace.enabled).toBe(false);
        expect(work).toHaveBeenCalledOnce();
        expect(timer).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(sampleHealth).not.toHaveBeenCalled();
    });

    it('keeps bounded numeric health maxima and survives an unavailable sampler', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const sampleHealth = vi.fn()
            .mockReturnValueOnce({ jsHeapUsedMiB: 10_500.4, jsHeapTotalMiB: 15_500,
                jsHeapLimitMiB: 16_000, domImageCount: 100, domLoadedImageCount: 80,
                decodedImagePixels: 800_000_000, domNodeCount: 4_000, secretPath: 'C:/private/image.png' })
            .mockImplementationOnce(() => { throw new Error('health API unavailable'); })
            .mockReturnValueOnce({ jsHeapUsedMiB: 9_000, domImageCount: 90,
                decodedImagePixels: Number.POSITIVE_INFINITY, domNodeCount: -1 });
        const { trace, writes } = setup({ sampleHealth });
        const id = Symbol();
        trace.observeOperation(operation(id));
        await vi.advanceTimersByTimeAsync(6_000);
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const content = writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content;
        const completed = JSON.parse(content);
        const beats = completed.events.filter((event: { kind: string }) => event.kind === 'heartbeat');
        expect(beats).toHaveLength(3);
        expect(beats[0]).toMatchObject({ jsHeapUsedMiB: 10_500, domImageCount: 100,
            domLoadedImageCount: 80, decodedImagePixels: 800_000_000, domNodeCount: 4_000 });
        expect(beats[1].jsHeapUsedMiB).toBeUndefined();
        expect(beats[2].decodedImagePixels).toBeUndefined();
        expect(completed.healthMax).toMatchObject({ jsHeapUsedMiB: 10_500,
            jsHeapTotalMiB: 15_500, jsHeapLimitMiB: 16_000, domImageCount: 100,
            domLoadedImageCount: 80, decodedImagePixels: 800_000_000, domNodeCount: 4_000 });
        expect(content).not.toContain('secretPath');
        expect(content).not.toContain('private');
        expect(content.length).toBeLessThanOrEqual(256 * 1024);
    });

    it('bounds events and persists only allowlisted fields, including terminal summary', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { trace, writes } = setup();
        const id = Symbol('C:/secret/symbol');
        trace.observeOperation(operation(id));
        for (let index = 0; index < 600; index += 1) trace.serviceProgress(id, index, 600);
        trace.observeOperation({ ...operation(id, 'completed'), imported: 12, updated: 4 });
        await Promise.resolve();
        const terminal = writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json');
        expect(terminal).toBeDefined();
        const data = JSON.parse(terminal!.content) as { events: unknown[]; droppedEvents: number; terminal: string; serviceProgress: number };
        expect(data.events.length).toBeLessThanOrEqual(512);
        expect(data.droppedEvents).toBeGreaterThan(0);
        expect(data.terminal).toBe('completed');
        expect(data.serviceProgress).toBe(600);
        expect(terminal!.content.length).toBeLessThanOrEqual(256 * 1024);
        expect(terminal!.content).not.toMatch(/secret|private|raw-progress|symbol/);
    });

    it('retains a bounded repair aggregate after event eviction without recording private fields', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { trace, writes } = setup();
        const id = Symbol();
        trace.observeOperation(operation(id));
        const repair = trace.claimRepair(id);
        expect(repair).toBeDefined();
        expect(trace.claimRepair(id)).toBeUndefined();
        repair?.stage('C:/secret/stage' as 'identity');
        const done = repair?.start('fact-read');
        await vi.advanceTimersByTimeAsync(25);
        repair?.count('factRows', 2_000_000_000);
        repair?.count('C:/secret/counter' as 'factRows', 1);
        done?.();
        repair?.finish('completed');
        for (let index = 0; index < 600; index += 1) trace.serviceProgress(id, index, 600);
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const content = writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content;
        const completed = JSON.parse(content);
        expect(completed.repairReport).toMatchObject({ status: 'completed', durationMs: 25,
            counters: { factRows: 1_000_000_000 }, metrics: expect.arrayContaining([
                { operation: 'fact-read', calls: 1, totalMs: 25, maxMs: 25 },
            ]) });
        expect(completed.repairReport.metrics).toHaveLength(14);
        expect(completed.events).toHaveLength(512);
        expect(content).not.toContain('C:/secret');
        expect(content.length).toBeLessThanOrEqual(256 * 1024);
    });

    it('does not attach an old repair report to a newer run', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let sequence = 0;
        const { trace, writes } = setup({ runId: () => `run-${++sequence}` });
        const oldId = Symbol();
        const newId = Symbol();
        trace.observeOperation(operation(oldId));
        const oldRepair = trace.claimRepair(oldId);
        trace.observeOperation(operation(oldId, 'completed'));
        trace.observeOperation(operation(newId));
        expect(trace.claimRepair(oldId)).toBeUndefined();
        const newRepair = trace.claimRepair(newId);
        expect(newRepair).toBeDefined();
        oldRepair?.count('factRows', 999);
        oldRepair?.finish('completed');
        newRepair?.count('factRows', 7);
        newRepair?.finish('completed');
        trace.observeOperation(operation(newId, 'completed'));
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
        const completed = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-last-completed.json').at(-1)!.content);
        expect(completed.runId).toBe('run-2');
        expect(completed.repairReport.counters.factRows).toBe(7);
    });

    it('ignores stale operation symbols and keeps completed output separate from the new active run', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let sequence = 0;
        const { trace, writes } = setup({ runId: () => `run-${++sequence}` });
        const oldId = Symbol('old');
        const newId = Symbol('new');
        trace.observeOperation(operation(oldId));
        trace.observeOperation(operation(oldId, 'completed'));
        await Promise.resolve();
        trace.observeOperation(operation(newId));
        trace.observeOperation(operation(oldId, 'failed'));
        trace.serviceProgress(oldId, 99, 99);
        trace.serviceProgress(newId, 1, 2);
        await vi.advanceTimersByTimeAsync(2_000);
        await Promise.resolve();
        await Promise.resolve();
        const active = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-active.json').at(-1)!.content);
        const completed = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-last-completed.json').at(-1)!.content);
        expect(active.runId).toBe('run-2');
        expect(active.terminal).toBeUndefined();
        expect(active.serviceProgress).toBe(1);
        expect(completed.runId).toBe('run-1');
        expect(completed.terminal).toBe('completed');
    });

    it('persists a wall-clock anchor and overlapping pending stage counts before held work settles', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { trace, writes } = setup({ wallNow: () => 1_791_710_000_123 });
        const id = Symbol();
        trace.observeOperation(operation(id));
        let releaseFirst: (() => void) | undefined;
        let releaseSecond: (() => void) | undefined;
        const first = trace.measure(id, 'source-reconciliation', () => new Promise<void>(resolve => { releaseFirst = resolve; }));
        const second = trace.measure(id, 'source-reconciliation', () => new Promise<void>(resolve => { releaseSecond = resolve; }));
        await vi.advanceTimersByTimeAsync(2_000);
        const pending = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-active.json').at(-1)!.content);
        expect(pending.wallStartedAtEpochMs).toBe(1_791_710_000_123);
        expect(pending.stages['source-reconciliation']).toMatchObject({ started: 2, pending: 2, count: 0 });
        expect(pending.events.filter((event: { kind: string; status?: string }) => event.kind === 'stage' && event.status === 'started')).toHaveLength(2);
        releaseFirst?.();
        await first;
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const completed = JSON.parse(writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content);
        expect(completed.stages['source-reconciliation']).toMatchObject({ started: 2, pending: 1, count: 1 });
        releaseSecond?.();
        await second;
    });

    it('uses cumulative committed totals and final operation counters without double counting', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { trace, writes } = setup();
        const id = Symbol();
        trace.observeOperation(operation(id));
        trace.committedBatch(id, 500, 400, 75);
        trace.committedBatch(id, 1_000, 850, 150);
        trace.observeOperation({ ...operation(id, 'completed'), imported: 850, updated: 150 });
        await Promise.resolve();
        const completed = JSON.parse(writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content);
        expect(completed.committedBatches).toBe(2);
        expect(completed.committedImages).toBe(1_000);
        expect(completed.imported).toBe(850);
        expect(completed.updated).toBe(150);
    });

    it('records terminal Dock acknowledgement after completion but rejects stale Dock updates', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let sequence = 0;
        const { trace, writes } = setup({ runId: () => `run-${++sequence}` });
        const first = Symbol();
        const second = Symbol();
        trace.observeOperation(operation(first));
        trace.observeOperation(operation(first, 'completed'));
        trace.dockCommitted(operation(first, 'completed'), true);
        await Promise.resolve();
        await Promise.resolve();
        const firstCompleted = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-last-completed.json').at(-1)!.content);
        expect(firstCompleted.events.some((event: { kind: string; phase?: string }) =>
            event.kind === 'dock-committed' && event.phase === 'completed')).toBe(true);
        trace.observeOperation(operation(second));
        trace.dockCommitted(operation(first, 'completed'), false);
        trace.observeOperation(operation(second, 'completed'));
        trace.dockCommitted(operation(first, 'completed'), false);
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
        const latest = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-last-completed.json').at(-1)!.content);
        expect(latest.runId).toBe('run-2');
        expect(latest.events.some((event: { kind: string }) => event.kind === 'dock-committed')).toBe(false);
    });

    it('records committed privacy and browse transitions without repeating or leaking stale runs', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let sequence = 0;
        const { trace, writes } = setup({ runId: () => `run-${++sequence}` });
        const first = Symbol();
        const second = Symbol();
        trace.observeOperation(operation(first));
        trace.presentationCommitted(first, true, false);
        trace.presentationCommitted(first, true, false);
        await vi.advanceTimersByTimeAsync(100);
        trace.presentationCommitted(first, false, true);
        trace.observeOperation(operation(first, 'completed'));
        trace.presentationCommitted(first, false, false);
        trace.presentationCommitted(first, false, false);
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
        const completed = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-last-completed.json').at(-1)!.content);
        expect(completed.presentationSummary).toEqual({
            firstPrivacyBlockedAtMs: 0,
            lastPrivacyUnblockedAtMs: 100,
            firstBrowsingAvailableAtMs: 100,
        });
        expect(completed.events.filter((event: { kind: string }) => event.kind === 'presentation-committed')).toHaveLength(3);
        trace.observeOperation(operation(second));
        trace.presentationCommitted(first, true, true);
        trace.observeOperation(operation(second, 'completed'));
        trace.presentationCommitted(first, true, true);
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
        const latest = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-last-completed.json').at(-1)!.content);
        expect(latest.runId).toBe('run-2');
        expect(latest.presentationSummary).toEqual({});
    });

    it('classifies fixed progress categories and ignores repeated same-stage evidence for stall detection', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { trace, writes } = setup();
        const id = Symbol();
        trace.observeOperation({ ...operation(id), progress: { current: 0, total: 0, message: 'Updating gallery...' } });
        trace.dockCommitted({ ...operation(id), progress: { current: 0, total: 0, message: 'Updating gallery...' } }, true);
        await vi.advanceTimersByTimeAsync(2_000);
        trace.coordinatorProgress(id, 0, 0, 'Updating gallery...');
        await vi.advanceTimersByTimeAsync(31_000);
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const completed = JSON.parse(writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content);
        expect(completed.displayStallSuspected).toBe(false);
        expect(completed.events.some((event: { progressCategory?: string }) => event.progressCategory === 'gallery')).toBe(true);
        expect(JSON.stringify(completed)).not.toContain('Updating gallery...');
    });

    it('reports a visible display stall only after newer coordinator evidence and stops heartbeat at terminal', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { trace, writes } = setup();
        const id = Symbol();
        trace.observeOperation(operation(id));
        trace.dockCommitted(operation(id), true);
        await vi.advanceTimersByTimeAsync(3_000);
        trace.coordinatorProgress(id, 2, 5);
        await vi.advanceTimersByTimeAsync(30_000);
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const completed = JSON.parse(writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content);
        expect(completed.displayStallSuspected).toBe(true);
        expect(completed.events.some((event: { kind: string; documentVisible?: boolean; gapMs?: number }) =>
            event.kind === 'heartbeat' && event.documentVisible === true && event.gapMs === 2_000)).toBe(true);
        expect(completed.events.some((event: { kind: string }) => event.kind === 'suspected-display-stall')).toBe(true);
        const count = writes.length;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(writes).toHaveLength(count);
    });

    it('does not classify a hidden document as a display stall', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { trace, writes } = setup({ documentVisible: () => false });
        const id = Symbol();
        trace.observeOperation(operation(id));
        trace.dockCommitted(operation(id), true);
        await vi.advanceTimersByTimeAsync(3_000);
        trace.coordinatorProgress(id, 2, 5);
        await vi.advanceTimersByTimeAsync(30_000);
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const completed = JSON.parse(writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content);
        expect(completed.displayStallSuspected).toBe(false);
    });

    it('excludes a hidden interval even when heartbeat timers pause until the document returns', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let visible = true;
        let listener: ((nextVisible: boolean) => void) | undefined;
        const unsubscribe = vi.fn();
        const { trace, writes } = setup({
            documentVisible: () => visible,
            subscribeVisibility: callback => { listener = callback; return unsubscribe; },
        });
        const id = Symbol();
        trace.observeOperation(operation(id));
        trace.dockCommitted(operation(id), true);
        visible = false;
        listener?.(false);
        // Simulate browser timer suspension: wall time moves, timers do not run.
        vi.setSystemTime(40_000);
        trace.coordinatorProgress(id, 2, 5);
        visible = true;
        listener?.(true);
        await vi.advanceTimersByTimeAsync(2_000);
        const afterReturn = JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-active.json').at(-1)!.content);
        expect(afterReturn.displayStallSuspected).toBe(false);
        trace.coordinatorProgress(id, 3, 5);
        await vi.advanceTimersByTimeAsync(32_000);
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const completed = JSON.parse(writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content);
        expect(completed.displayStallSuspected).toBe(true);
        expect(completed.events.filter((event: { kind: string }) => event.kind === 'visibility')).toHaveLength(2);
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('serializes pending writes so an old run cannot overwrite a newer run', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let release: (() => void) | undefined;
        const writes: Array<{ fileName: string; content: string }> = [];
        let call = 0;
        const { trace } = setup({
            runId: () => `run-${++call}`,
            write: async (fileName, content) => {
                if (!release) await new Promise<void>(resolve => { release = resolve; });
                writes.push({ fileName, content });
            },
        });
        const first = Symbol();
        const second = Symbol();
        trace.observeOperation(operation(first));
        await vi.advanceTimersByTimeAsync(2_000);
        trace.observeOperation(operation(first, 'completed'));
        trace.observeOperation(operation(second));
        trace.observeOperation(operation(second, 'completed'));
        release?.();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
        expect(JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-active.json').at(-1)!.content).runId).toBe('run-2');
        expect(JSON.parse(writes.filter(entry => entry.fileName === 'invoke-sync-trace-last-completed.json').at(-1)!.content).runId).toBe('run-2');
    });

    it('keeps task values and original errors while a write is pending or fails', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let release: (() => void) | undefined;
        const write = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
            .mockRejectedValue(new Error('disk failure'));
        const { trace } = setup({ write });
        const id = Symbol();
        trace.observeOperation(operation(id));
        await vi.advanceTimersByTimeAsync(2_000);
        expect(await trace.measure(id, 'filesystem', async () => 'result')).toBe('result');
        const taskError = new Error('private task failure');
        await expect(trace.measure(id, 'references', async () => { throw taskError; })).rejects.toBe(taskError);
        trace.observeOperation(operation(id, 'failed'));
        release?.();
        await Promise.resolve();
        await Promise.resolve();
        expect(write).toHaveBeenCalled();
        expect(write.mock.calls.map(call => call[1] as string).join('')).not.toContain(taskError.message);
    });

    it('suspends on unmount and resumes the same run after a StrictMode remount', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const unsubscribe = vi.fn();
        const subscribeVisibility = vi.fn(() => unsubscribe);
        const { trace, writes } = setup({ subscribeVisibility });
        const id = Symbol();
        trace.observeOperation(operation(id));
        trace.dockCommitted(operation(id), true);
        trace.dispose();
        expect(unsubscribe).toHaveBeenCalledOnce();
        await Promise.resolve();
        const count = writes.length;
        await vi.advanceTimersByTimeAsync(40_000);
        expect(writes).toHaveLength(count);
        trace.coordinatorProgress(id, 1, 5);
        trace.observeOperation(operation(id));
        expect(subscribeVisibility).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2_000);
        trace.observeOperation(operation(id, 'completed'));
        await Promise.resolve();
        const completed = JSON.parse(writes.find(entry => entry.fileName === 'invoke-sync-trace-last-completed.json')!.content);
        expect(completed.runId).toBe('opaque-test-run');
        expect(completed.terminal).toBe('completed');
        expect(completed.displayStallSuspected).toBe(false);
        expect(completed.events.some((event: { kind: string }) => event.kind === 'heartbeat')).toBe(true);
    });
});
