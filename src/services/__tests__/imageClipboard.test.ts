import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isBrowserMockMode: vi.fn(),
    copyImageToClipboard: vi.fn(),
}));

vi.mock('../runtime', () => ({
    isBrowserMockMode: mocks.isBrowserMockMode,
}));

vi.mock('../../bindings', () => ({
    commands: {
        copyImageToClipboard: mocks.copyImageToClipboard,
    },
}));

describe('copyImageToClipboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isBrowserMockMode.mockReturnValue(false);
    });

    it('copies through the native command with the library path', async () => {
        mocks.copyImageToClipboard.mockResolvedValue({ status: 'ok', data: null });

        const { copyImageToClipboard } = await import('../imageClipboard');
        await expect(copyImageToClipboard('C:/library/image.webp')).resolves.toEqual({ status: 'ok', data: null });

        expect(mocks.copyImageToClipboard).toHaveBeenCalledWith('C:/library/image.webp');
    });

    it('turns a thrown IPC failure into an error result the UI can show', async () => {
        mocks.copyImageToClipboard.mockRejectedValue(new Error('IPC down'));

        const { copyImageToClipboard } = await import('../imageClipboard');
        await expect(copyImageToClipboard('C:/library/image.png')).resolves.toEqual({ status: 'error', error: 'IPC down' });
    });

    it('ignores repeat requests while a copy runs, so a large image is decoded once', async () => {
        let finish: (value: { status: 'ok'; data: null }) => void = () => undefined;
        mocks.copyImageToClipboard.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            })
        );

        const { copyImageToClipboard } = await import('../imageClipboard');
        const first = copyImageToClipboard('C:/library/huge.png');
        await expect(copyImageToClipboard('C:/library/huge.png')).resolves.toEqual({ status: 'ignored' });
        await expect(copyImageToClipboard('C:/library/other.png')).resolves.toEqual({ status: 'ignored' });
        expect(mocks.copyImageToClipboard).toHaveBeenCalledOnce();

        finish({ status: 'ok', data: null });
        await expect(first).resolves.toEqual({ status: 'ok', data: null });

        // The guard is released afterwards, including after a failure.
        mocks.copyImageToClipboard.mockRejectedValueOnce(new Error('IPC down'));
        await expect(copyImageToClipboard('C:/library/next.png')).resolves.toEqual({ status: 'error', error: 'IPC down' });
        mocks.copyImageToClipboard.mockResolvedValueOnce({ status: 'ok', data: null });
        await expect(copyImageToClipboard('C:/library/next.png')).resolves.toEqual({ status: 'ok', data: null });
        expect(mocks.copyImageToClipboard).toHaveBeenCalledTimes(3);
    });

    it('reports unavailability in browser mock mode without calling the backend', async () => {
        mocks.isBrowserMockMode.mockReturnValue(true);

        const { copyImageToClipboard, COPY_IMAGE_BROWSER_UNAVAILABLE_MESSAGE } = await import('../imageClipboard');
        await expect(copyImageToClipboard('C:/library/image.png')).resolves.toEqual({
            status: 'error',
            error: COPY_IMAGE_BROWSER_UNAVAILABLE_MESSAGE,
        });
        expect(mocks.copyImageToClipboard).not.toHaveBeenCalled();
    });
});
