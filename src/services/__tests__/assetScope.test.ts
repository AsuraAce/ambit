import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    browserMockMode: false,
    appLocalDataDir: vi.fn(),
    registerLibraryPath: vi.fn(),
    waitForLibraryGrants: vi.fn(),
    readLibraryFile: vi.fn(),
}));

vi.mock('../runtime', () => ({
    isBrowserMockMode: () => mocks.browserMockMode,
}));

vi.mock('@tauri-apps/api/path', () => ({
    appLocalDataDir: mocks.appLocalDataDir,
}));

vi.mock('../../bindings', () => ({
    commands: {
        registerLibraryPath: mocks.registerLibraryPath,
        waitForLibraryGrants: mocks.waitForLibraryGrants,
        readLibraryFile: mocks.readLibraryFile,
    },
}));

const loadService = async () => {
    vi.resetModules();
    return import('../assetScope');
};

describe('assetScope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.browserMockMode = false;
        mocks.appLocalDataDir.mockResolvedValue('C:/Users/Test/AppData/Local/Ambit');
        mocks.registerLibraryPath.mockResolvedValue({ status: 'ok', data: null });
        mocks.waitForLibraryGrants.mockResolvedValue({ status: 'ok', data: null });
    });

    // #384: Live Watch and resource scans skipped missing folders before the scope
    // checks; a folder that cannot be registered must still be left out, not fail the call.
    it('keeps only the folders that could be registered, in order', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.registerLibraryPath.mockImplementation(async (path: string) =>
            path === 'D:/unplugged' ? { status: 'error', error: 'Failed to resolve library path' } : { status: 'ok', data: null }
        );
        const { ensureFolderAccessible, filterAccessibleFolders } = await loadService();

        await expect(filterAccessibleFolders(['C:/one', 'D:/unplugged', 'C:/two'])).resolves.toEqual(['C:/one', 'C:/two']);
        await expect(ensureFolderAccessible('D:/unplugged')).resolves.toBe(false);
        await expect(ensureFolderAccessible('C:/one')).resolves.toBe(true);
        expect(mocks.registerLibraryPath).toHaveBeenCalledWith('C:/one');
        consoleError.mockRestore();
    });

    it('does nothing in browser mock mode', async () => {
        mocks.browserMockMode = true;
        const { ensureAssetPathAccessible } = await loadService();

        await ensureAssetPathAccessible('C:/images/a.png');

        expect(mocks.appLocalDataDir).not.toHaveBeenCalled();
        expect(mocks.registerLibraryPath).not.toHaveBeenCalled();
    });

    it.each([
        null,
        undefined,
        '',
        'data:image/png;base64,abc',
        'blob:https://example.test/id',
        'https://example.test/image.png',
        'custom:opaque-value',
        'asset://',
        '/',
    ])('rejects non-local input %s', async (input) => {
        const { ensureAssetPathAccessible } = await loadService();

        await ensureAssetPathAccessible(input);

        expect(mocks.registerLibraryPath).not.toHaveBeenCalled();
    });

    it('allows local Tauri asset URLs while rejecting ordinary localhost-independent HTTP URLs', async () => {
        const { ensureAssetPathAccessible } = await loadService();

        await ensureAssetPathAccessible('http://asset.localhost/C%3A/images/a.png');

        expect(mocks.registerLibraryPath).toHaveBeenCalled();
    });

    it('skips files already inside AppLocalData and caches its resolved root', async () => {
        const { ensureAssetPathAccessible } = await loadService();

        await ensureAssetPathAccessible('C:/Users/Test/AppData/Local/Ambit/images/a.png');
        await ensureAssetPathAccessible('C:/Users/Test/AppData/Local/Ambit/thumbs/b.webp');

        expect(mocks.appLocalDataDir).toHaveBeenCalledTimes(1);
        expect(mocks.registerLibraryPath).not.toHaveBeenCalled();
    });

    it('registers a file parent or an explicitly supplied directory', async () => {
        const { ensureAssetPathAccessible } = await loadService();

        await ensureAssetPathAccessible('D:/images/a.png');
        await ensureAssetPathAccessible('E:/models', { assumeDirectory: true });

        expect(mocks.registerLibraryPath).toHaveBeenNthCalledWith(1, 'D:/images');
        expect(mocks.registerLibraryPath).toHaveBeenNthCalledWith(2, 'E:/models');
    });

    it('deduplicates concurrent and case-insensitive directory registration', async () => {
        let resolve!: (value: { status: 'ok'; data: null }) => void;
        mocks.registerLibraryPath.mockReturnValueOnce(
            new Promise((result) => {
                resolve = result;
            })
        );
        const { ensureAssetPathAccessible } = await loadService();

        const first = ensureAssetPathAccessible('D:/Images/a.png');
        const second = ensureAssetPathAccessible('d:/images/b.png');
        resolve({ status: 'ok', data: null });
        await Promise.all([first, second]);

        expect(mocks.registerLibraryPath).toHaveBeenCalledTimes(1);
    });

    it('logs AppLocalData resolution failures and still registers external paths', async () => {
        mocks.appLocalDataDir.mockRejectedValueOnce(new Error('path unavailable'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { ensureAssetPathAccessible } = await loadService();

        await ensureAssetPathAccessible('D:/images/a.png');

        expect(error).toHaveBeenCalledWith('[AssetScope] Failed to resolve AppLocalData directory', expect.any(Error));
        expect(mocks.registerLibraryPath).toHaveBeenCalledWith('D:/images');
        error.mockRestore();
    });

    it.each([{ status: 'error', error: 'scope denied' }, new Error('invoke failed')])(
        'evicts failed registrations so a later attempt can retry',
        async (failure) => {
            if (failure instanceof Error) {
                mocks.registerLibraryPath.mockRejectedValueOnce(failure);
            } else {
                mocks.registerLibraryPath.mockResolvedValueOnce(failure);
            }
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const { ensureAssetPathAccessible } = await loadService();

            await expect(ensureAssetPathAccessible('D:/images/a.png')).rejects.toThrow();
            await ensureAssetPathAccessible('D:/images/b.png');

            expect(mocks.registerLibraryPath).toHaveBeenCalledTimes(2);
            expect(error).toHaveBeenCalledWith('[AssetScope] Failed to register path scope for D:/images', expect.any(Error));
            error.mockRestore();
        }
    );

    // #392: waiting for Rust's grants must never register a settings folder from
    // the webview, and a failed wait must not keep the app from starting.
    it('waits for the restored grants without registering anything, and survives a failed wait', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { waitForLibraryGrants } = await loadService();

        await waitForLibraryGrants();
        mocks.waitForLibraryGrants.mockResolvedValueOnce({ status: 'error', error: 'gone' });
        await waitForLibraryGrants();
        mocks.waitForLibraryGrants.mockRejectedValueOnce(new Error('invoke failed'));
        await waitForLibraryGrants();

        expect(mocks.waitForLibraryGrants).toHaveBeenCalledTimes(3);
        expect(mocks.registerLibraryPath).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledTimes(2);
        error.mockRestore();
    });

    // #415: Rust sends a library file as raw bytes. Tauri delivers them as an
    // ArrayBuffer, or as numbers over its fallback IPC; anything else is no file.
    it('reads library files as bytes from either IPC form and refuses anything else', async () => {
        const { readLibraryFile } = await loadService();
        mocks.readLibraryFile.mockResolvedValueOnce({ status: 'ok', data: new Uint8Array([1, 2]).buffer });
        await expect(readLibraryFile('C:/library/a.png')).resolves.toEqual(new Uint8Array([1, 2]));
        mocks.readLibraryFile.mockResolvedValueOnce({ status: 'ok', data: [3, 4] });
        await expect(readLibraryFile('C:/library/a.png')).resolves.toEqual(new Uint8Array([3, 4]));
        mocks.readLibraryFile.mockResolvedValueOnce({ status: 'ok', data: 'not bytes' });
        await expect(readLibraryFile('C:/library/a.png')).rejects.toThrow('No file contents');
        mocks.readLibraryFile.mockResolvedValueOnce({ status: 'error', error: 'outside the grants' });
        await expect(readLibraryFile('C:/elsewhere/a.png')).rejects.toThrow('outside the grants');
    });

    it('does not wait for grants in browser mock mode', async () => {
        mocks.browserMockMode = true;
        const { waitForLibraryGrants } = await loadService();

        await waitForLibraryGrants();

        expect(mocks.waitForLibraryGrants).not.toHaveBeenCalled();
    });
});
