import { describe, expect, it, vi } from 'vitest';
import { createStartupLifecycleDiagnostics } from '../startupLifecycle';

describe('startup lifecycle diagnostics', () => {
    it('contains a synchronous startup subscription failure', () => {
        expect(() => createStartupLifecycleDiagnostics({
            subscribe: () => { throw new Error('diagnostics unavailable'); },
            transport: vi.fn().mockResolvedValue(undefined),
        })).not.toThrow();
    });

    it('drops stages before launch resolution instead of replaying them later', () => {
        let resolveLaunch: ((launchId: string) => void) | undefined;
        const transport = vi.fn().mockResolvedValue(undefined);
        const lifecycle = createStartupLifecycleDiagnostics({
            subscribe: listener => {
                resolveLaunch = listener;
                return () => undefined;
            },
            transport,
        });

        lifecycle.record('close-requested');
        resolveLaunch?.('launch-1');
        lifecycle.record('settings-drain-started');

        expect(transport).toHaveBeenCalledTimes(1);
        expect(transport).toHaveBeenCalledWith('launch-1', 'settings-drain-started');
    });

    it('deduplicates stages and bounds the close timeline to its nine fixed stages', () => {
        const transport = vi.fn().mockResolvedValue(undefined);
        const lifecycle = createStartupLifecycleDiagnostics({
            subscribe: listener => {
                listener('launch-1');
                return () => undefined;
            },
            transport,
        });

        const stages = [
            'close-requested',
            'settings-drain-started',
            'settings-drain-completed',
            'settings-drain-failed',
            'settings-flush-started',
            'settings-flush-completed',
            'settings-flush-failed',
            'exit-invoked',
            'exit-failed',
        ] as const;
        stages.forEach(stage => lifecycle.record(stage));
        lifecycle.record('close-requested');

        expect(transport).toHaveBeenCalledTimes(9);
        expect(transport.mock.calls).toEqual(stages.map(stage => ['launch-1', stage]));
    });

    it('contains synchronous and rejected diagnostic transport failures', async () => {
        const transport = vi.fn()
            .mockImplementationOnce(() => { throw new Error('transport unavailable'); })
            .mockRejectedValueOnce(new Error('transport unavailable'));
        const lifecycle = createStartupLifecycleDiagnostics({
            subscribe: listener => {
                listener('launch-1');
                return () => undefined;
            },
            transport,
        });

        expect(() => lifecycle.record('close-requested')).not.toThrow();
        expect(() => lifecycle.record('settings-drain-started')).not.toThrow();
        await Promise.resolve();

        expect(transport).toHaveBeenCalledTimes(2);
    });
});
