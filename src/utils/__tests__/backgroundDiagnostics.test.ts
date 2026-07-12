import { beforeEach, describe, expect, it, vi } from 'vitest';

interface DiagnosticWindow extends Window {
    ambitDiagnostics?: { background?: { snapshot: () => { active: Array<{ id: string; detail?: Record<string, unknown> }>; history: Array<{ id: string; status: string; detail?: Record<string, unknown> }> } } };
}

describe('backgroundDiagnostics', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as DiagnosticWindow).ambitDiagnostics;
        vi.unstubAllEnvs();
    });

    it('returns inert handles when diagnostics are disabled', async () => {
        vi.stubEnv('DEV', false);
        const { startBackgroundDiagnostic } = await import('../backgroundDiagnostics');
        const handle = startBackgroundDiagnostic('job', 'disabled');
        handle.update({ value: 1 });
        handle.finish('failed');
        expect(handle.id).toBe('');
        expect((window as DiagnosticWindow).ambitDiagnostics).toBeUndefined();
    });

    it('tracks cloned active state, updates, and final history', async () => {
        vi.stubEnv('DEV', true);
        (window as DiagnosticWindow).ambitDiagnostics = {};
        vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(110).mockReturnValueOnce(120);
        const { startBackgroundDiagnostic } = await import('../backgroundDiagnostics');
        const handle = startBackgroundDiagnostic('worker', 'index', { first: 1 });
        const snapshot = (window as DiagnosticWindow).ambitDiagnostics?.background?.snapshot;
        expect(snapshot).toBeDefined();
        const active = snapshot?.().active[0];
        if (active?.detail) active.detail.first = 99;
        expect(snapshot?.().active[0].detail).toEqual({ first: 1 });

        handle.update({ second: 2 });
        handle.update();
        handle.finish('cancelled', { final: true });
        handle.update({ ignored: true });
        handle.finish();
        const final = snapshot?.();
        expect(final?.active).toEqual([]);
        expect(final?.history[0]).toMatchObject({ status: 'cancelled', detail: { first: 1, second: 2, final: true } });
    });

    it('tracks active entries without optional details', async () => {
        vi.stubEnv('DEV', true);
        const { startBackgroundDiagnostic } = await import('../backgroundDiagnostics');
        const handle = startBackgroundDiagnostic('listener', 'plain');
        const snapshot = (window as DiagnosticWindow).ambitDiagnostics?.background?.snapshot;
        expect(snapshot?.().active[0].detail).toBeUndefined();
        handle.update();
        expect(snapshot?.().active[0].detail).toEqual({});
    });

    it('keeps only the newest one hundred completed entries and defaults status', async () => {
        vi.stubEnv('DEV', true);
        let now = 1000;
        vi.spyOn(Date, 'now').mockImplementation(() => now++);
        const { startBackgroundDiagnostic } = await import('../backgroundDiagnostics');
        for (let index = 0; index < 101; index += 1) {
            startBackgroundDiagnostic('timer', `timer-${index}`).finish();
        }
        const history = (window as DiagnosticWindow).ambitDiagnostics?.background?.snapshot().history ?? [];
        expect(history).toHaveLength(100);
        expect(history[0].status).toBe('finished');
        expect(history.some(entry => entry.id.includes('timer-0'))).toBe(false);
    });
});
