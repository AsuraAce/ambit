import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../../types';
import { ResourcesTab } from '../ResourcesTab';

const mocks = vi.hoisted(() => ({ logic: {} as Record<string, unknown> }));
vi.mock('../../hooks/useResourcesTabLogic', () => ({ useResourcesTabLogic: () => mocks.logic }));
vi.mock('../ResourceDiscoverySection', () => ({ ResourceDiscoverySection: ({ onBrowse, onAdd, onRemove, onScanNow }: { onBrowse: () => void; onAdd: () => void; onRemove: (path: string) => void; onScanNow: () => void }) => <><button onClick={onBrowse}>browse</button><button onClick={onAdd}>add-folder</button><button onClick={() => onRemove('path')}>remove-folder</button><button onClick={onScanNow}>scan</button></> }));
vi.mock('../../../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: ({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) => <><button onClick={onCancel}>cancel-confirm</button><button onClick={onConfirm}>confirm-resolve</button></> }));

const fn = () => vi.fn();
const baseLogic = () => ({
    resourceFolders: [], isScanningDiscovery: false, discoveryScanProgress: null, isPopulatingThumbnails: false,
    removingResourcePath: null, newResourcePath: '', setNewResourcePath: fn(), resourceInputRef: { current: null },
    handleBrowseResource: fn(), handleAddResourceFolder: fn(), handleRemoveResourceFolder: fn(), handleScanNow: fn(),
    isResolving: false, resolutionProgress: null, resolutionProgressPercent: 0, resolutionResult: null,
    isHashResolutionBlocked: false, isResolveConfirmOpen: false, requestResolveOnline: fn(), confirmResolveOnline: fn(),
    cancelResolveOnline: fn(), cancelResolveConfirmation: fn()
});

describe('ResourcesTab', () => {
    beforeEach(() => { mocks.logic = baseLogic(); });

    it('routes discovery, resolve, and confirmation actions', () => {
        const logic = mocks.logic as ReturnType<typeof baseLogic>;
        render(<ResourcesTab settings={{} as AppSettings} setSettings={vi.fn()} />);
        for (const label of ['browse', 'add-folder', 'remove-folder', 'scan', 'Resolve Online', 'cancel-confirm', 'confirm-resolve']) fireEvent.click(screen.getByText(label));
        expect(logic.handleBrowseResource).toHaveBeenCalled();
        expect(logic.handleAddResourceFolder).toHaveBeenCalled();
        expect(logic.handleRemoveResourceFolder).toHaveBeenCalledWith('path');
        expect(logic.handleScanNow).toHaveBeenCalled();
        expect(logic.requestResolveOnline).toHaveBeenCalled();
        expect(logic.cancelResolveConfirmation).toHaveBeenCalled();
        expect(logic.confirmResolveOnline).toHaveBeenCalled();
    });

    it('shows blocked, resolving, progress, and both result states', () => {
        const cancelResolveOnline = vi.fn();
        mocks.logic = { ...baseLogic(), isResolving: true, resolutionProgress: { message: 'Hash 2 of 4' }, resolutionProgressPercent: 50, resolutionResult: { success: true, message: 'Resolved' }, cancelResolveOnline };
        const { container, rerender } = render(<ResourcesTab settings={{} as AppSettings} setSettings={vi.fn()} />);
        expect(screen.getByText('Hash 2 of 4')).toBeTruthy();
        expect(screen.getByText('50 %')).toBeTruthy();
        expect(screen.getByText('Success')).toBeTruthy();
        fireEvent.click(container.querySelector('section button') as HTMLElement);
        expect(cancelResolveOnline).toHaveBeenCalled();

        mocks.logic = { ...baseLogic(), isHashResolutionBlocked: true, resolutionResult: { success: false, message: 'Some unresolved' } };
        rerender(<ResourcesTab settings={{} as AppSettings} setSettings={vi.fn()} />);
        expect(screen.getByText('Library Busy')).toBeTruthy();
        expect((screen.getByTitle('Wait for the current library task to finish') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Resolution Partial')).toBeTruthy();
    });
});
