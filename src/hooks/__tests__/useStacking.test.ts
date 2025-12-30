
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
                    groups: mockGroups
                }
            });
        });

        expect(result.current.suggestedStacks).toEqual(mockGroups);
        expect(result.current.isCalculating).toBe(false);
    });
});
