import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeDbQueryReason, timeDbCall } from '../dbTiming';

describe('dbTiming', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('describes every query cost reason and the default', () => {
        expect(describeDbQueryReason(undefined)).toBe('default');
        expect(describeDbQueryReason(
            'positive_prompt LIKE ? AND negative_prompt LIKE ? AND timestamp >= ? AND timestamp < ? AND privacy_hidden = 0 AND EXISTS (SELECT 1 FROM image_resources)',
            'collection-1',
            'detail'
        )).toBe('collection+lora+prompt-like+negative-prompt-like+date+privacy+resource-exists');
    });

    it('logs duration for successful and failed calls', async () => {
        vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(15).mockReturnValueOnce(20).mockReturnValueOnce(29);
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await expect(timeDbCall('select', 'default', async () => 'done')).resolves.toBe('done');
        await expect(timeDbCall('write', 'collection', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
        expect(info).toHaveBeenNthCalledWith(1, '[DB] select (default) completed in 5ms');
        expect(info).toHaveBeenNthCalledWith(2, '[DB] write (collection) completed in 9ms');
    });

    it('falls back to Date when performance is unavailable', async () => {
        vi.stubGlobal('performance', undefined);
        vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(107);
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await timeDbCall('fallback', 'default', async () => undefined);
        expect(info).toHaveBeenCalledWith('[DB] fallback (default) completed in 7ms');
    });
});
