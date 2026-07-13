import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { TitleBar } from '../TitleBar';

const appWindow = vi.hoisted(() => ({
    setIcon: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    isFullscreen: vi.fn().mockResolvedValue(false),
    listen: vi.fn().mockResolvedValue(vi.fn()),
    minimize: vi.fn().mockResolvedValue(undefined),
    maximize: vi.fn().mockResolvedValue(undefined),
    unmaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/runtime', () => ({
    isTauriRuntime: () => true,
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => appWindow,
}));

describe('TitleBar window controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps window actions keyboard-visible without changing their behavior', async () => {
        render(<TitleBar />);

        const minimizeButton = await screen.findByRole('button', { name: 'Minimize Window' });
        const maximizeButton = screen.getByRole('button', { name: 'Maximize Window' });
        const closeButton = screen.getByRole('button', { name: 'Close Window' });

        for (const button of [minimizeButton, maximizeButton, closeButton]) {
            expect(button.className).toContain('focus-visible:ring-2');
            expect(button.className).not.toContain('focus:outline-none');
        }

        fireEvent.click(minimizeButton);
        expect(appWindow.minimize).toHaveBeenCalledOnce();
    });
});
