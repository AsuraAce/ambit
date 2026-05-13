import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isBrowserMockMode: vi.fn(),
    openFile: vi.fn(),
    showInFolder: vi.fn(),
}));

vi.mock('../runtime', () => ({
    isBrowserMockMode: mocks.isBrowserMockMode,
}));

vi.mock('../../bindings', () => ({
    commands: {
        openFile: mocks.openFile,
        showInFolder: mocks.showInFolder,
    },
}));

describe('osOpen helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isBrowserMockMode.mockReturnValue(false);
    });

    it('opens files through generated commands outside browser mock mode', async () => {
        mocks.openFile.mockResolvedValue({ status: 'ok', data: null });

        const { openFileInDefaultApp } = await import('../osOpen');
        await expect(openFileInDefaultApp('C:/library/image.png')).resolves.toEqual({
            status: 'ok',
            data: null,
        });

        expect(mocks.openFile).toHaveBeenCalledWith('C:/library/image.png');
    });

    it('shows paths in folders through generated commands outside browser mock mode', async () => {
        mocks.showInFolder.mockResolvedValue({ status: 'ok', data: null });

        const { showPathInFolder } = await import('../osOpen');
        await expect(showPathInFolder('C:/library/image.png')).resolves.toEqual({
            status: 'ok',
            data: null,
        });

        expect(mocks.showInFolder).toHaveBeenCalledWith('C:/library/image.png');
    });

    it('does not call Tauri commands in browser mock mode', async () => {
        mocks.isBrowserMockMode.mockReturnValue(true);

        const { openFileInDefaultApp, showPathInFolder, OS_OPEN_BROWSER_UNAVAILABLE_MESSAGE } = await import('../osOpen');
        await expect(openFileInDefaultApp('C:/library/image.png')).resolves.toEqual({
            status: 'error',
            error: OS_OPEN_BROWSER_UNAVAILABLE_MESSAGE,
        });
        await expect(showPathInFolder('C:/library/image.png')).resolves.toEqual({
            status: 'error',
            error: OS_OPEN_BROWSER_UNAVAILABLE_MESSAGE,
        });

        expect(mocks.openFile).not.toHaveBeenCalled();
        expect(mocks.showInFolder).not.toHaveBeenCalled();
    });

    it('returns backend rejection results without throwing', async () => {
        mocks.openFile.mockResolvedValue({ status: 'error', error: 'Refusing to open an untracked file' });

        const { openFileInDefaultApp } = await import('../osOpen');
        await expect(openFileInDefaultApp('C:/library/untracked.png')).resolves.toEqual({
            status: 'error',
            error: 'Refusing to open an untracked file',
        });
    });

    it('converts thrown command errors into error results', async () => {
        mocks.showInFolder.mockRejectedValue(new Error('invoke failed'));

        const { showPathInFolder } = await import('../osOpen');
        await expect(showPathInFolder('C:/library/image.png')).resolves.toEqual({
            status: 'error',
            error: 'invoke failed',
        });
    });
});
