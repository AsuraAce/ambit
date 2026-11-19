import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryDropResult } from '../../bindings';
import type { AppSettings, MonitoredFolder } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { DROP_BUSY_MESSAGE, DROP_UNAVAILABLE_MESSAGE, useDropImport } from '../useDropImport';

const runtime = vi.hoisted(() => ({ tauri: true }));
const listeners = vi.hoisted(() => new Map<string, (event: { payload: LibraryDropResult }) => void>());
const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    postDroppedFiles: vi.fn(),
}));

vi.mock('../../services/runtime', () => ({ isTauriRuntime: () => runtime.tauri }));
vi.mock('../../services/dropImportService', () => ({ postDroppedFiles: mocks.postDroppedFiles }));
vi.mock('../useToast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../../utils/tauriListener', () => ({
    listenWithCleanup: (event: string, handler: (event: { payload: LibraryDropResult }) => void) => {
        listeners.set(event, handler);
        return { cleanup: vi.fn() };
    },
}));

const dropResult = (overrides: Partial<LibraryDropResult> = {}): LibraryDropResult => ({
    dropId: 'drop-1',
    files: [],
    folders: [],
    declinedFolders: [],
    unsupported: [],
    unreadable: [],
    withoutPath: [],
    ...overrides,
});

const file = (name: string) => new File(['x'], name);

describe('useDropImport', () => {
    const importPaths = vi.fn();
    const importFolders = vi.fn();
    const importWebFiles = vi.fn();
    const setSettings = vi.fn();

    const renderDropImport = (monitoredFolders: MonitoredFolder[] = []) =>
        renderHook(() => useDropImport({ importPaths, importFolders, importWebFiles, monitoredFolders, setSettings }));

    /** Drops files, which the mocked bridge posts as `drop-1`, then delivers Rust's answer. */
    const dropAndAnswer = async (files: File[], result: LibraryDropResult) => {
        const { result: hook } = renderDropImport();
        act(() => hook.current.handleDropFiles(files));
        await act(async () => listeners.get('library-drop-result')?.({ payload: result }));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        listeners.clear();
        runtime.tauri = true;
        useLibraryStore.setState({ isImporting: false });
        mocks.postDroppedFiles.mockReturnValue({ status: 'posted', dropId: 'drop-1' });
        importPaths.mockResolvedValue(undefined);
        importFolders.mockResolvedValue(undefined);
        importWebFiles.mockResolvedValue(undefined);
    });

    it('turns a drop away with a clear message while another import runs, instead of queueing it', () => {
        useLibraryStore.setState({ isImporting: true });
        const { result } = renderDropImport();

        act(() => result.current.handleDropFiles([file('a.png')]));

        expect(mocks.addToast).toHaveBeenCalledWith(DROP_BUSY_MESSAGE, 'info');
        expect(mocks.postDroppedFiles).not.toHaveBeenCalled();
    });

    it('says so when the webview cannot hand the drop to Ambit', () => {
        mocks.postDroppedFiles.mockReturnValue({ status: 'unavailable' });
        const { result } = renderDropImport();

        act(() => result.current.handleDropFiles([file('a.png')]));

        expect(mocks.addToast).toHaveBeenCalledWith(DROP_UNAVAILABLE_MESSAGE, 'error');
    });

    it('asks the user to save an image dragged from a browser before dropping it', () => {
        mocks.postDroppedFiles.mockReturnValue({ status: 'not-on-disk' });
        const { result } = renderDropImport();

        act(() => result.current.handleDropFiles([file('cat.png')]));

        expect(mocks.addToast).toHaveBeenCalledWith("cat.png isn't a file on disk. Save it to a folder first, then drop it.", 'warning');
        expect(importPaths).not.toHaveBeenCalled();
    });

    it('imports the granted files of its own drop in place, with the right media kind', async () => {
        await dropAndAnswer([file('a.png'), file('b.mp4')], dropResult({ files: ['C:\\in\\a.png', 'C:\\in\\b.mp4'] }));
        expect(importPaths).toHaveBeenCalledWith(['C:\\in\\a.png', 'C:\\in\\b.mp4'], undefined, { mediaKind: 'media' });

        importPaths.mockClear();
        await dropAndAnswer([file('a.png')], dropResult({ files: ['C:\\in\\a.png'] }));
        expect(importPaths).toHaveBeenCalledWith(['C:\\in\\a.png'], undefined, { mediaKind: 'images' });
    });

    it('ignores a result for a drop it did not post, and a second result for the same drop', async () => {
        const { result } = renderDropImport();
        await act(async () => listeners.get('library-drop-result')?.({ payload: dropResult({ files: ['C:/x.png'] }) }));
        expect(importPaths).not.toHaveBeenCalled();

        act(() => result.current.handleDropFiles([file('x.png')]));
        await act(async () => listeners.get('library-drop-result')?.({ payload: dropResult({ files: ['C:/x.png'] }) }));
        await act(async () => listeners.get('library-drop-result')?.({ payload: dropResult({ files: ['C:/x.png'] }) }));
        expect(importPaths).toHaveBeenCalledTimes(1);
    });

    it('names what it could not import: unsupported, unreadable, and items with no file on disk', async () => {
        await dropAndAnswer(
            [file('notes.txt'), file('web.png'), file('locked.png')],
            dropResult({ unsupported: ['C:\\in\\notes.txt'], withoutPath: [1], unreadable: ['C:\\in\\locked.png'] })
        );

        expect(mocks.addToast).toHaveBeenCalledWith(
            "web.png isn't a file on disk. Save it to a folder first, then drop it. " +
                "Can't import notes.txt: Ambit imports PNG, JPG and WebP images and MP4, WebM, MOV, M4V and MKV videos. " +
                "Couldn't read locked.png.",
            'warning'
        );
        expect(importPaths).not.toHaveBeenCalled();
    });

    it('reports a failed import of the dropped files', async () => {
        importPaths.mockRejectedValueOnce(new Error('disk gone'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await dropAndAnswer([file('a.png')], dropResult({ files: ['C:/in/a.png'] }));

        expect(mocks.addToast).toHaveBeenCalledWith('Import of the dropped items failed', 'error');
    });

    it('adds a confirmed folder as a library folder and scans it, but not one already in the library', async () => {
        const known = { id: 'folder_1', path: 'C:/lib/known', isActive: true, imageCount: 3 } as MonitoredFolder;
        const { result } = renderDropImport([known]);
        act(() => result.current.handleDropFiles([file('known'), file('new')]));
        await act(async () =>
            listeners.get('library-drop-result')?.({ payload: dropResult({ folders: ['C:\\lib\\known', 'C:\\art\\new'] }) })
        );

        expect(mocks.addToast).toHaveBeenCalledWith('Already a library folder: C:/lib/known', 'info');
        expect(mocks.addToast).toHaveBeenCalledWith('Added folder: C:/art/new', 'success');
        const addFolders = setSettings.mock.calls[0][0] as (prev: AppSettings) => AppSettings;
        expect(addFolders({ monitoredFolders: [known] } as AppSettings).monitoredFolders).toEqual([
            known,
            expect.objectContaining({ path: 'C:/art/new', isActive: true, initialScanPending: true }),
        ]);
        expect(importFolders).toHaveBeenCalledWith([{ path: 'C:/art/new', variant: expect.any(String) }]);
    });

    it('imports dropped files in memory in the browser mock mode, without the desktop bridge', () => {
        runtime.tauri = false;
        const { result } = renderDropImport();
        const dropped = [file('a.png')];

        act(() => result.current.handleDropFiles(dropped));

        expect(importWebFiles).toHaveBeenCalledWith(dropped);
        expect(mocks.postDroppedFiles).not.toHaveBeenCalled();
        expect(listeners.size).toBe(0);
    });
});
