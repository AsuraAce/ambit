import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useViewerKeyboard } from './useViewerKeyboard';

describe('useViewerKeyboard', () => {
    // Viewer handlers close over the current image; a key press must reach the newest handler,
    // not the one from the render that attached the window listener.
    it('sends key presses to the handler from the latest render', () => {
        const firstHandler = vi.fn();
        const latestHandler = vi.fn();
        const { rerender } = renderHook((onKeyDown: (event: KeyboardEvent) => void) => useViewerKeyboard({ onKeyDown }), {
            initialProps: firstHandler,
        });

        rerender(latestHandler);
        fireEvent.keyDown(window, { key: 'ArrowRight' });

        expect(firstHandler).not.toHaveBeenCalled();
        expect(latestHandler).toHaveBeenCalledTimes(1);
    });
});
