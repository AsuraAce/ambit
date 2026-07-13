import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../types';

const mocks = vi.hoisted(() => ({
    browserMockMode: false,
    appLocalDataDir: vi.fn(),
    registerLibraryPath: vi.fn()
}));

vi.mock('../runtime', () => ({
    isBrowserMockMode: () => mocks.browserMockMode
}));

vi.mock('@tauri-apps/api/path', () => ({
    appLocalDataDir: mocks.appLocalDataDir
}));

vi.mock('../../bindings', () => ({
    commands: { registerLibraryPath: mocks.registerLibraryPath }
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
        '/'
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
        mocks.registerLibraryPath.mockReturnValueOnce(new Promise(result => { resolve = result; }));
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

    it.each([
        { status: 'error', error: 'scope denied' },
        new Error('invoke failed')
    ])('evicts failed registrations so a later attempt can retry', async (failure) => {
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
        expect(error).toHaveBeenCalledWith(
            '[AssetScope] Failed to register path scope for D:/images',
            expect.any(Error)
        );
        error.mockRestore();
    });

    it('registers every configured monitored, resource, and normalized Invoke root', async () => {
        const { ensureConfiguredAssetPathsAccessible } = await loadService();
        const settings = {
            monitoredFolders: [
                { id: 'one', path: 'D:/images', isActive: true, imageCount: 0 },
                { id: 'two', path: 'E:/images', isActive: false, imageCount: 0 }
            ],
            resourceFolders: ['F:/models'],
            invokeAiPath: 'G:/InvokeAI/databases'
        } satisfies Pick<AppSettings, 'monitoredFolders' | 'resourceFolders' | 'invokeAiPath'>;

        await ensureConfiguredAssetPathsAccessible(settings);

        expect(mocks.registerLibraryPath).toHaveBeenCalledWith('D:/images');
        expect(mocks.registerLibraryPath).toHaveBeenCalledWith('E:/images');
        expect(mocks.registerLibraryPath).toHaveBeenCalledWith('F:/models');
        expect(mocks.registerLibraryPath).toHaveBeenCalledWith('G:/InvokeAI');
    });

    it('supports absent optional configured paths', async () => {
        const { ensureConfiguredAssetPathsAccessible } = await loadService();

        await ensureConfiguredAssetPathsAccessible({ monitoredFolders: [], invokeAiPath: undefined });

        expect(mocks.registerLibraryPath).not.toHaveBeenCalled();
    });
});
