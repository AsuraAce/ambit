import { act, renderHook } from '../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIImage, GeneratorTool } from '../../types';
import { useExportOps } from '../useExportOps';

const mocks = vi.hoisted(() => ({
    browserMode: false,
    addToast: vi.fn(),
    getImagesByIds: vi.fn(),
    exportImagesToZip: vi.fn(),
}));

vi.mock('../../services/runtime', () => ({ isBrowserMockMode: () => mocks.browserMode }));
vi.mock('../useToast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../../services/db/imageRepo', () => ({ getImagesByIds: mocks.getImagesByIds }));
vi.mock('../../services/exportService', () => ({ exportImagesToZip: mocks.exportImagesToZip }));

const image = (id: string): AIImage => ({
    id,
    url: id,
    thumbnailUrl: id,
    filename: `${id}.png`,
    timestamp: 1,
    width: 1,
    height: 1,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: '',
        positivePrompt: '',
        negativePrompt: '',
    },
});

describe('useExportOps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.browserMode = false;
        mocks.getImagesByIds.mockResolvedValue([]);
        mocks.exportImagesToZip.mockResolvedValue(undefined);
    });

    it('rejects exports in browser mock mode', async () => {
        mocks.browserMode = true;
        const { result } = renderHook(() => useExportOps({ images: [image('one')] }));

        await act(async () => result.current.exportImages('out.zip', ['one'], 'C:/out'));

        expect(mocks.addToast).toHaveBeenCalledWith('Unavailable in browser mock mode.', 'info');
        expect(mocks.exportImagesToZip).not.toHaveBeenCalled();
    });

    it('ignores empty selections and destinations', async () => {
        const { result } = renderHook(() => useExportOps({ images: [] }));

        await act(async () => result.current.exportImages('out.zip', [], 'C:/out'));
        await act(async () => result.current.exportImages('out.zip', ['one'], ''));

        expect(mocks.getImagesByIds).not.toHaveBeenCalled();
        expect(result.current.isExporting).toBe(false);
    });

    it('loads off-page selections, exports them, and invokes completion', async () => {
        const local = image('local');
        const remote = image('remote');
        mocks.getImagesByIds.mockResolvedValue([local, remote]);
        const onComplete = vi.fn();
        const { result } = renderHook(() => useExportOps({ images: [local] }));

        await act(async () => result.current.exportImages(
            'selected.zip',
            new Set(['local', 'remote']),
            'C:/out',
            onComplete
        ));

        expect(mocks.getImagesByIds).toHaveBeenCalledWith(['local', 'remote']);
        expect(mocks.exportImagesToZip).toHaveBeenCalledWith([local, remote], 'C:/out', 'selected.zip');
        expect(mocks.addToast).toHaveBeenCalledWith('Export complete', 'success');
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(result.current.isExporting).toBe(false);
    });

    it('reports when selected ids no longer resolve to images', async () => {
        const { result } = renderHook(() => useExportOps({ images: [] }));

        await act(async () => result.current.exportImages('out.zip', ['missing'], 'C:/out'));

        expect(mocks.addToast).toHaveBeenCalledWith('No valid images found to export', 'error');
        expect(mocks.exportImagesToZip).not.toHaveBeenCalled();
        expect(result.current.isExporting).toBe(false);
    });

    it('reports export failures and clears exporting state', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.exportImagesToZip.mockRejectedValue(new Error('archive failed'));
        const { result } = renderHook(() => useExportOps({ images: [image('one')] }));

        await act(async () => result.current.exportImages('out.zip', ['one'], 'C:/out'));

        expect(error).toHaveBeenCalledWith('Export error', expect.any(Error));
        expect(mocks.addToast).toHaveBeenCalledWith('Export failed', 'error');
        expect(result.current.isExporting).toBe(false);
        error.mockRestore();
    });
});
