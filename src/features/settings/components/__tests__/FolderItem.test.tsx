import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type MonitoredFolder } from '../../../../types';
import { FolderItem } from '../FolderItem';

const folder = (overrides: Partial<MonitoredFolder> = {}): MonitoredFolder => ({
    id: 'folder-1', path: 'C:/images', isActive: true, imageCount: 12, ...overrides
});

const setup = (target = folder(), scanningIds = new Set<string>(), onRefresh: ((path: string, force: boolean, variant?: GeneratorTool, managed?: boolean) => void) | null = vi.fn()) => {
    const props = { folder: target, scanningIds, onRescan: vi.fn(), onRemove: vi.fn(), onRefresh: onRefresh ?? undefined };
    const result = render(<FolderItem {...props} />);
    return { ...result, props };
};

describe('FolderItem', () => {
    beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));

    it('routes rescan, removal, and normal or forced refresh for watched folders', () => {
        const { props, container } = setup(folder({ variant: GeneratorTool.COMFYUI }));
        expect(screen.getByText('COMFY')).toBeTruthy();
        expect(screen.getByText('12 images')).toBeTruthy();
        expect(screen.getByText('Monitored Folder')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Rescan Folder'));
        fireEvent.click(screen.getByTitle('Resume Smart Refresh (Shift+Click to Force Refresh All)'));
        fireEvent.click(screen.getByTitle('Resume Smart Refresh (Shift+Click to Force Refresh All)'), { shiftKey: true });
        const remove = container.querySelector('.lucide-trash-2')?.closest('button') as HTMLButtonElement;
        fireEvent.click(remove);
        expect(props.onRescan).toHaveBeenCalledWith('folder-1', 'C:/images', GeneratorTool.COMFYUI, undefined);
        expect(props.onRefresh).toHaveBeenNthCalledWith(1, 'C:/images', false, GeneratorTool.COMFYUI, undefined);
        expect(props.onRefresh).toHaveBeenNthCalledWith(2, 'C:/images', true, GeneratorTool.COMFYUI, undefined);
        expect(props.onRemove).toHaveBeenCalledWith('folder-1');
    });

    it('uses managed raw paths, database sync labels, and cancelled-import status', () => {
        const target = folder({ isManaged: true, path: 'virtual', pathRaw: 'D:/Invoke/outputs', variant: GeneratorTool.INVOKEAI, initialScanCancelled: true });
        const { props } = setup(target);
        expect(screen.getByText('INVOKE')).toBeTruthy();
        expect(screen.getByText('D:/Invoke/outputs')).toBeTruthy();
        expect(screen.getByText('Import cancelled. Rescan to continue.')).toBeTruthy();
        expect(screen.queryByText(/images$/)).toBeNull();
        fireEvent.click(screen.getByTitle('Sync with InvokeAI Database'));
        expect(props.onRescan).toHaveBeenCalledWith('folder-1', 'D:/Invoke/outputs', GeneratorTool.INVOKEAI, true);
        expect(document.querySelector('.lucide-trash-2')).toBeNull();
    });

    it('falls back to managed normalized paths and hides optional refresh controls', () => {
        setup(folder({ isManaged: true, pathRaw: undefined, variant: GeneratorTool.UNKNOWN }), new Set(), null);
        expect(screen.getByText('C:/images')).toBeTruthy();
        expect(screen.getByText('Managed Integration')).toBeTruthy();
        expect(screen.queryByTitle('Resume Smart Refresh (Shift+Click to Force Refresh All)')).toBeNull();
    });

    it('disables controls and animates rescans while scanning', () => {
        const { container } = setup(folder(), new Set(['folder-1']));
        const rescan = screen.getByTitle('Rescan Folder') as HTMLButtonElement;
        const refresh = screen.getByTitle('Resume Smart Refresh (Shift+Click to Force Refresh All)') as HTMLButtonElement;
        expect(rescan.disabled).toBe(true);
        expect(refresh.disabled).toBe(true);
        expect(container.querySelector('.animate-spin')).toBeTruthy();
    });

    it.each([
        [GeneratorTool.AUTOMATIC1111, 'A1111'],
        [GeneratorTool.SDNEXT, 'SD.NEXT'],
        [GeneratorTool.FORGE, 'FORGE'],
        [GeneratorTool.ANAPNOE, 'ANAPNOE']
    ])('renders the %s integration badge', (variant, label) => {
        setup(folder({ variant }));
        expect(screen.getByText(label)).toBeTruthy();
    });

    it('renders no integration badge for unrecognized future variants', () => {
        const { container } = setup(folder({ variant: 'future-tool' as GeneratorTool }));
        expect(screen.getByText('C:/images')).toBeTruthy();
        expect(container.querySelector('.w-16')?.textContent).toBe('');
    });
});
