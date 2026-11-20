import { useLayoutEffect } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStacking } from '../useStacking';

// Worker is globally mocked in setup.ts

describe('useStacking', () => {
    const mockImages = [
        { id: '1', timestamp: 100, width: 512, height: 512, metadata: { positivePrompt: 'A cat' } },
        { id: '2', timestamp: 101, width: 512, height: 512, metadata: { positivePrompt: 'A cat' } },
    ] as any[];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('should start calculating after debounce', async () => {
        const { result } = renderHook(() => useStacking(mockImages));

        expect(result.current.isCalculating).toBe(true);

        act(() => {
            vi.advanceTimersByTime(600);
        });

        // Worker was postMessage-d (can't easily check internal worker state yet
        // without more elaborate MockWorker, but we check isCalculating stayed true
        // until result comes)
        expect(result.current.isCalculating).toBe(true);
    });

    it('should update stacks when worker returns data', async () => {
        const { result } = renderHook(() => useStacking(mockImages));

        act(() => {
            vi.advanceTimersByTime(600);
        });

        // Simulating worker message
        const mockGroups = [{ id: 'stack1', baseImage: mockImages[0], relatedImages: [mockImages[1]], reason: 'similar', confidence: 0.9 }];

        // Find the latest postMessage call to get the correct requestId
        const postMessageCalls = (Worker.prototype.postMessage as any).mock.calls;
        const lastPayload = postMessageCalls[postMessageCalls.length - 1][0];
        const requestId = lastPayload.requestId;

        // Find the LATEST addEventListener for message
        const addListenerCalls = (Worker.prototype.addEventListener as any).mock.calls.filter(([ev]: any) => ev === 'message');
        const latestHandler = addListenerCalls[addListenerCalls.length - 1][1];

        act(() => {
            latestHandler({
                data: {
                    type: 'stacks-result',
                    requestId: requestId,
                    groups: mockGroups,
                },
            });
        });

        expect(result.current.suggestedStacks).toEqual(mockGroups);
        expect(result.current.isCalculating).toBe(false);
    });

    it('resets immediately for an empty library', () => {
        const { result } = renderHook(() => useStacking([]));

        expect(result.current.suggestedStacks).toEqual([]);
        expect(result.current.isCalculating).toBe(false);
        expect(Worker.prototype.postMessage).not.toHaveBeenCalled();
    });

    it('cancels an active worker listener when images are cleared', () => {
        const removeEventListener = vi.spyOn(Worker.prototype, 'removeEventListener');
        const { result, rerender } = renderHook(({ images }) => useStacking(images), { initialProps: { images: mockImages } });
        act(() => vi.advanceTimersByTime(500));
        expect(result.current.isCalculating).toBe(true);

        rerender({ images: [] });

        expect(result.current.isCalculating).toBe(false);
        expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('does not restart analysis for an unchanged length and first timestamp signature', () => {
        const { rerender } = renderHook(({ images }) => useStacking(images), { initialProps: { images: mockImages } });
        act(() => vi.advanceTimersByTime(500));
        expect(Worker.prototype.postMessage).toHaveBeenCalledTimes(1);

        rerender({ images: [{ ...mockImages[0] }, { ...mockImages[1], timestamp: 999 }] });
        act(() => vi.advanceTimersByTime(500));

        expect(Worker.prototype.postMessage).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending debounce when the image signature changes', () => {
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const { rerender } = renderHook(({ images }) => useStacking(images), { initialProps: { images: mockImages } });

        rerender({ images: [...mockImages, { ...mockImages[1], id: '3' }] });
        act(() => vi.advanceTimersByTime(500));

        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(Worker.prototype.postMessage).toHaveBeenCalledTimes(1);
    });

    it('normalizes string, object, and missing model values in the worker payload', () => {
        const images = [
            { ...mockImages[0], metadata: { ...mockImages[0].metadata, model: 'String Model' } },
            { ...mockImages[1], metadata: { ...mockImages[1].metadata, model: { name: 'Object Model' } } },
            { ...mockImages[1], id: '3', metadata: { ...mockImages[1].metadata, model: null } },
            { ...mockImages[1], id: '4', metadata: { ...mockImages[1].metadata, model: { name: undefined } } },
            { ...mockImages[1], id: '5', metadata: { ...mockImages[1].metadata, model: { name: { key: 'nested' } } } },
        ];
        renderHook(() => useStacking(images));
        act(() => vi.advanceTimersByTime(500));

        const calls = vi.mocked(Worker.prototype.postMessage).mock.calls;
        const payload = calls[calls.length - 1][0] as { images: Array<{ metadata: { model: string } }> };
        expect(payload.images.map((image) => image.metadata.model)).toEqual(['String Model', 'Object Model', '', '', '']);
    });

    it('clears a previously suggested stack when the library becomes empty', () => {
        const { result, rerender } = renderHook(({ images }) => useStacking(images), { initialProps: { images: mockImages } });
        act(() => vi.advanceTimersByTime(500));
        const requestId = (vi.mocked(Worker.prototype.postMessage).mock.calls.at(-1)?.[0] as { requestId: string }).requestId;
        const handler = vi.mocked(Worker.prototype.addEventListener).mock.calls.at(-1)?.[1] as EventListener;
        act(() =>
            handler(
                new MessageEvent('message', {
                    data: { requestId, type: 'stacks-result', groups: [{ id: 'stack' }] },
                })
            )
        );

        rerender({ images: [] });

        expect(result.current.suggestedStacks).toEqual([]);
    });

    it('ignores stale replies and completes matching worker errors without replacing stacks', () => {
        const { result } = renderHook(() => useStacking(mockImages));
        act(() => vi.advanceTimersByTime(500));
        const calls = vi.mocked(Worker.prototype.postMessage).mock.calls;
        const requestId = (calls[calls.length - 1][0] as { requestId: string }).requestId;
        const listenerCalls = vi.mocked(Worker.prototype.addEventListener).mock.calls;
        const handler = listenerCalls[listenerCalls.length - 1][1] as EventListener;

        act(() =>
            handler(
                new MessageEvent('message', {
                    data: { requestId: 'stale', type: 'stacks-result', groups: [{ id: 'wrong' }] },
                })
            )
        );
        expect(result.current.isCalculating).toBe(true);

        act(() =>
            handler(
                new MessageEvent('message', {
                    data: { requestId, error: 'analysis failed' },
                })
            )
        );
        expect(result.current.suggestedStacks).toEqual([]);
        expect(result.current.isCalculating).toBe(false);

        act(() =>
            handler(
                new MessageEvent('message', {
                    data: { requestId, error: 'duplicate completion' },
                })
            )
        );
        expect(result.current.isCalculating).toBe(false);
    });

    // `isCalculating` drives the spinner; it must be right in the frame where the images change, not one commit later.
    describe('committed frames', () => {
        type Frame = { isCalculating: boolean; stackCount: number };
        const renderRecordedStacking = (initialImages: unknown[]) => {
            const frames: Frame[] = [];
            const hook = renderHook(
                ({ images }: { images: unknown[] }) => {
                    const value = useStacking(images as Parameters<typeof useStacking>[0]);
                    useLayoutEffect(() => {
                        frames.push({ isCalculating: value.isCalculating, stackCount: value.suggestedStacks.length });
                    });
                    return value;
                },
                { initialProps: { images: initialImages } }
            );
            return { ...hook, frames };
        };

        const completeLatestRequest = () => {
            const requestId = (vi.mocked(Worker.prototype.postMessage).mock.calls.at(-1)?.[0] as { requestId: string }).requestId;
            const handler = vi.mocked(Worker.prototype.addEventListener).mock.calls.at(-1)?.[1] as EventListener;
            act(() => handler(new MessageEvent('message', { data: { requestId, type: 'stacks-result', groups: [{ id: 'stack' }] } })));
        };

        it('is calculating on the first frame for a non-empty library and idle for an empty one', () => {
            expect(renderRecordedStacking(mockImages).frames[0].isCalculating).toBe(true);
            expect(renderRecordedStacking([]).frames).toEqual([{ isCalculating: false, stackCount: 0 }]);
        });

        it('starts calculating in the first frame of a new image signature', () => {
            const { result, rerender, frames } = renderRecordedStacking(mockImages);
            act(() => vi.advanceTimersByTime(500));
            completeLatestRequest();
            expect(result.current.isCalculating).toBe(false);

            frames.length = 0;
            rerender({ images: [...mockImages, { ...mockImages[1], id: '3' }] });

            expect(frames[0].isCalculating).toBe(true);
        });

        it('stays idle when new image objects keep the same signature', () => {
            const { result, rerender, frames } = renderRecordedStacking(mockImages);
            act(() => vi.advanceTimersByTime(500));
            completeLatestRequest();

            frames.length = 0;
            rerender({ images: mockImages.map((image) => ({ ...image })) });
            act(() => vi.advanceTimersByTime(500));

            expect(frames.every((frame) => !frame.isCalculating)).toBe(true);
            expect(result.current.isCalculating).toBe(false);
        });

        it('clears stacks and stops calculating in the first frame once the library is empty', () => {
            const { rerender, frames } = renderRecordedStacking(mockImages);
            act(() => vi.advanceTimersByTime(500));
            completeLatestRequest();
            expect(frames.at(-1)).toEqual({ isCalculating: false, stackCount: 1 });

            frames.length = 0;
            rerender({ images: [] });

            expect(frames).toEqual([{ isCalculating: false, stackCount: 0 }]);
        });
    });
});
