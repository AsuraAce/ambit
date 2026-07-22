import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExactDuplicateResolution } from '../../bindings';
import { GeneratorTool, type AIImage } from '../../types';
import { useDuplicateFinder } from '../useDuplicateFinder';

const image = (id: string, timestamp: number, fileHash?: string): AIImage => ({
    id,
    timestamp,
    fileSize: 1_000,
    fileHash,
    url: `url-${id}`,
    thumbnailUrl: `thumb-${id}`,
    filename: `${id}.png`,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        seed: 12345,
        positivePrompt: 'same metadata',
        negativePrompt: 'low quality',
        steps: 20,
        cfg: 7,
        sampler: 'Euler a',
        model: 'v1.5',
    },
});

describe('useDuplicateFinder', () => {
    const onResolve = vi.fn<(resolutions: ExactDuplicateResolution[]) => Promise<void>>();

    beforeEach(() => {
        vi.clearAllMocks();
        onResolve.mockResolvedValue(undefined);
    });

    it('groups only repeated non-empty SHA-256 values', () => {
        const { result } = renderHook(() => useDuplicateFinder([
            image('one', 1, 'same-hash'),
            image('two', 2, 'same-hash'),
            image('other', 3, 'other-hash'),
        ], onResolve));

        expect(result.current.groups).toHaveLength(1);
        expect(result.current.groups[0].id).toBe('exact_same-hash');
        expect(result.current.groups[0].images.map(candidate => candidate.id)).toEqual(['one', 'two']);
        expect(result.current.totalRedundantCount).toBe(1);
    });

    it('does not group matching metadata, dimensions, and file size without an equal hash', () => {
        const { result } = renderHook(() => useDuplicateFinder([
            image('unhashed-one', 1),
            image('unhashed-two', 2),
            image('hash-one', 3, 'hash-a'),
            image('hash-two', 4, 'hash-b'),
        ], onResolve));

        expect(result.current.groups).toEqual([]);
    });

    it('excludes missing, intermediate, deleted, and pre-grouped records', () => {
        const candidates = [
            { ...image('missing', 1, 'same'), isMissing: true },
            { ...image('intermediate', 2, 'same'), isIntermediate: true },
            { ...image('deleted', 3, 'same'), isDeleted: true },
            { ...image('grouped', 4, 'same'), groupId: 'stack' },
            image('eligible', 5, 'same'),
        ];

        const { result } = renderHook(() => useDuplicateFinder(candidates, onResolve));

        expect(result.current.groups).toEqual([]);
    });

    it('passes the selected keeper mapping for a single group', async () => {
        const { result } = renderHook(() => useDuplicateFinder([
            image('one', 1, 'same'),
            image('two', 2, 'same'),
        ], onResolve));

        await act(async () => result.current.handleResolve('two', ['one', 'two']));

        expect(onResolve).toHaveBeenCalledWith([{ keepId: 'two', removeIds: ['one'] }]);
    });

    it('keeps the latest modified record in every exact group during bulk resolution', async () => {
        const { result } = renderHook(() => useDuplicateFinder([
            image('old-a', 1, 'hash-a'),
            image('new-a', 3, 'hash-a'),
            image('old-b', 2, 'hash-b'),
            image('new-b', 4, 'hash-b'),
        ], onResolve));

        await act(async () => result.current.handleBulkResolve('latestModified'));

        expect(onResolve).toHaveBeenCalledWith([
            { keepId: 'new-a', removeIds: ['old-a'] },
            { keepId: 'new-b', removeIds: ['old-b'] },
        ]);
    });

    it('keeps the earliest modified record and uses ID as a deterministic timestamp tie-breaker', async () => {
        const { result } = renderHook(() => useDuplicateFinder([
            image('b', 1, 'same'),
            image('a', 1, 'same'),
            image('new', 2, 'same'),
        ], onResolve));

        expect(result.current.groups[0].latestModifiedId).toBe('new');
        await act(async () => result.current.handleBulkResolve('earliestModified'));

        expect(onResolve).toHaveBeenCalledWith([
            { keepId: 'a', removeIds: ['b', 'new'] },
        ]);
    });

    it('stays pending until persistence finishes and leaves canonical groups visible on failure', async () => {
        let rejectResolution: (reason?: unknown) => void = () => undefined;
        onResolve.mockImplementation(() => new Promise<void>((_resolve, reject) => {
            rejectResolution = reject;
        }));
        const { result } = renderHook(() => useDuplicateFinder([
            image('one', 1, 'same'),
            image('two', 2, 'same'),
        ], onResolve));

        let pending: Promise<void> | undefined;
        act(() => {
            pending = result.current.handleResolve('one', ['one', 'two']);
        });
        expect(result.current.isResolving).toBe(true);

        await act(async () => {
            rejectResolution(new Error('write failed'));
            await expect(pending).rejects.toThrow('write failed');
        });

        expect(result.current.isResolving).toBe(false);
        expect(result.current.groups).toHaveLength(1);
    });

    it('ignores a second resolution while the first transaction is pending', async () => {
        let finishResolution: () => void = () => undefined;
        onResolve.mockImplementation(() => new Promise<void>(resolve => {
            finishResolution = resolve;
        }));
        const { result } = renderHook(() => useDuplicateFinder([
            image('one', 1, 'same'),
            image('two', 2, 'same'),
        ], onResolve));

        let first: Promise<void> | undefined;
        let second: Promise<void> | undefined;
        act(() => {
            first = result.current.handleResolve('one', ['one', 'two']);
            second = result.current.handleResolve('two', ['one', 'two']);
        });

        expect(onResolve).toHaveBeenCalledTimes(1);
        await act(async () => {
            finishResolution();
            await Promise.all([first, second]);
        });
        expect(result.current.isResolving).toBe(false);
    });
});
