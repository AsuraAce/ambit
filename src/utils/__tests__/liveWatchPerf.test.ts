import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveWatchPerfId, debugLiveWatchPerf, elapsedMs, infoLiveWatchPerf, liveWatchNow } from '../liveWatchPerf';

describe('liveWatchPerf', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses performance timing and creates stable-format identifiers', () => {
        vi.spyOn(performance, 'now').mockReturnValue(12.6);
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(liveWatchNow()).toBe(12.6);
        expect(elapsedMs(2.2)).toBe(10);
        expect(createLiveWatchPerfId('invoke')).toMatch(/^invoke-rs-/);
    });

    it('falls back to Date timing', () => {
        vi.stubGlobal('performance', undefined);
        vi.spyOn(Date, 'now').mockReturnValue(55);
        expect(liveWatchNow()).toBe(55);
    });

    it('logs empty, structured, and unserializable data', () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        debugLiveWatchPerf('empty');
        debugLiveWatchPerf('also empty', {});
        infoLiveWatchPerf('data', { count: 2 });
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        infoLiveWatchPerf('circular', circular);
        expect(debug).toHaveBeenNthCalledWith(1, '[LiveWatchPerf] empty');
        expect(debug).toHaveBeenNthCalledWith(2, '[LiveWatchPerf] also empty');
        expect(info).toHaveBeenNthCalledWith(1, '[LiveWatchPerf] data {"count":2}');
        expect(info).toHaveBeenNthCalledWith(2, '[LiveWatchPerf] circular {"serializationError":true}');
    });
});
