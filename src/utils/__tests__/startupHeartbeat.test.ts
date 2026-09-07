import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartupHeartbeat } from '../startupHeartbeat';

afterEach(() => {
    vi.useRealTimers();
});

describe('startup heartbeat', () => {
    it('starts on transport connection and keeps a two-second cadence after completion', async () => {
        vi.useFakeTimers();
        let now = 0;
        const transport = vi.fn().mockResolvedValue(undefined);
        const heartbeat = createStartupHeartbeat({
            now: () => now,
            transport,
            timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
        });

        heartbeat.begin();
        heartbeat.connect('launch-1');
        await vi.advanceTimersByTimeAsync(0);
        expect(transport).toHaveBeenCalledTimes(1);
        expect(transport).toHaveBeenLastCalledWith('launch-1');

        now = 1_999;
        await vi.advanceTimersByTimeAsync(1_999);
        expect(transport).toHaveBeenCalledTimes(1);
        now = 2_000;
        await vi.advanceTimersByTimeAsync(1);
        expect(transport).toHaveBeenCalledTimes(2);
    });

    it('never overlaps or replays a hung transport request', async () => {
        vi.useFakeTimers();
        let now = 0;
        const transport = vi.fn(() => new Promise<void>(() => undefined));
        const heartbeat = createStartupHeartbeat({
            now: () => now,
            transport,
            timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
        });

        heartbeat.begin();
        heartbeat.connect('launch-1');
        await vi.advanceTimersByTimeAsync(0);
        now = 10_000;
        await vi.advanceTimersByTimeAsync(10_000);

        expect(transport).toHaveBeenCalledOnce();
    });

    it('does not start a request when it stops before transport connection', async () => {
        vi.useFakeTimers();
        let now = 0;
        const transport = vi.fn().mockResolvedValue(undefined);
        const heartbeat = createStartupHeartbeat({
            now: () => now,
            transport,
            timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
        });

        heartbeat.begin();
        heartbeat.stop();
        heartbeat.connect('launch-1');
        now = 120_000;
        await vi.advanceTimersByTimeAsync(120_000);

        expect(transport).not.toHaveBeenCalled();
    });

    it('does not resume after a hung request resolves following stop', async () => {
        vi.useFakeTimers();
        let now = 0;
        let resolveRequest: (() => void) | undefined;
        const transport = vi.fn(() => new Promise<void>(resolve => { resolveRequest = resolve; }));
        const heartbeat = createStartupHeartbeat({
            now: () => now,
            transport,
            timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
        });

        heartbeat.begin();
        heartbeat.connect('launch-1');
        await vi.advanceTimersByTimeAsync(0);
        heartbeat.stop();
        resolveRequest?.();
        await Promise.resolve();
        now = 2_000;
        await vi.advanceTimersByTimeAsync(2_000);

        expect(transport).toHaveBeenCalledOnce();
    });

    it('uses a fixed deadline from frontend entry despite a late transport connection', async () => {
        vi.useFakeTimers();
        let now = 0;
        const transport = vi.fn().mockResolvedValue(undefined);
        const heartbeat = createStartupHeartbeat({
            now: () => now,
            transport,
            timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
        });

        heartbeat.begin();
        now = 119_999;
        await vi.advanceTimersByTimeAsync(119_999);
        heartbeat.connect('late-launch');
        await vi.advanceTimersByTimeAsync(0);
        expect(transport).toHaveBeenCalledOnce();

        now = 120_000;
        await vi.advanceTimersByTimeAsync(1);
        now = 122_000;
        await vi.advanceTimersByTimeAsync(2_000);
        expect(transport).toHaveBeenCalledOnce();
    });

    it('does not replay a rejected transport before the next cadence', async () => {
        vi.useFakeTimers();
        let now = 0;
        const transport = vi.fn().mockRejectedValue(new Error('unavailable'));
        const heartbeat = createStartupHeartbeat({
            now: () => now,
            transport,
            timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
        });

        heartbeat.begin();
        heartbeat.connect('launch-1');
        await vi.advanceTimersByTimeAsync(0);
        now = 1_999;
        await vi.advanceTimersByTimeAsync(1_999);

        expect(transport).toHaveBeenCalledOnce();
        heartbeat.stop();
    });

    it('contains a synchronous transport failure without scheduling an immediate replay', async () => {
        vi.useFakeTimers();
        let now = 0;
        const transport = vi.fn(() => { throw new Error('unavailable'); });
        const heartbeat = createStartupHeartbeat({
            now: () => now,
            transport,
            timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
        });

        heartbeat.begin();
        heartbeat.connect('launch-1');
        await vi.advanceTimersByTimeAsync(0);
        now = 1_999;
        await vi.advanceTimersByTimeAsync(1_999);

        expect(transport).toHaveBeenCalledOnce();
        heartbeat.stop();
    });
});
