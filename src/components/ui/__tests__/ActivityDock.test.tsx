import * as React from 'react';
import { act, fireEvent, render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityDock } from '../ActivityDock';
import { createInitialLiveWatchSessionState, useLibraryStore } from '../../../stores/libraryStore';

vi.mock('framer-motion', () => ({
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
        div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
    }
}));

const resetLibraryStore = () => {
    useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    useLibraryStore.setState({
        liveWatchSession: createInitialLiveWatchSessionState(),
        syncStatus: 'idle',
        syncProgress: { current: 0, total: 0, message: '' },
        isImporting: false,
        importProgress: null,
        importAbortController: null,
        importRunId: null,
        importRunOwner: null,
        isRegeneratingThumbnails: false,
        thumbnailProgress: null,
        isResolvingModels: false,
        modelResolutionProgress: null,
        isScanningDiscovery: false,
        discoveryScanProgress: null,
        isScanningDuplicates: false,
        duplicateScanProgress: null,
        duplicateScanScope: 'global',
        lastDuplicateScanResult: null,
        isScanningMissingFiles: false,
        missingScanProgress: null,
        missingScanAbortController: null,
        lastMissingScanResult: null,
        isBackgroundHealingActive: false,
        backgroundHealingProgress: null,
        backgroundHealingDetails: null,
        backgroundHealingPaused: false,
        isRefreshingMetadata: false,
        refreshProgress: null,
        isActivityDockDismissed: false,
        isActivityDockMinimized: false
    });
};

describe('ActivityDock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetLibraryStore();
    });

    it('renders the manual syncing card with cancel controls', () => {
        useLibraryStore.setState({
            syncStatus: 'syncing',
            syncProgress: { current: 2, total: 5, message: 'Syncing collections...' }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Syncing')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(screen.queryByText('Live Watch')).toBeNull();
    });

    it('renders duplicate scan progress with cancel controls', () => {
        useLibraryStore.setState({
            isScanningDuplicates: true,
            duplicateScanProgress: {
                current: 4,
                total: 10,
                message: 'Hashing images for exact duplicate detection...'
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Duplicate Scan')).toBeTruthy();
        expect(screen.getByText('4 / 10')).toBeTruthy();
        expect(screen.getByText('Hashing images for exact duplicate detection...')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('renders missing file audit progress with cancel controls', () => {
        useLibraryStore.setState({
            isScanningMissingFiles: true,
            missingScanProgress: {
                current: 3,
                total: 12,
                message: 'Checking file paths for missing images...'
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Missing File Audit')).toBeTruthy();
        expect(screen.getByText('3 / 12')).toBeTruthy();
        expect(screen.getByText('Checking file paths for missing images...')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('renders import progress without cancel when no abort controller is registered', () => {
        useLibraryStore.setState({
            isImporting: true,
            importProgress: {
                current: 1,
                total: 5,
                message: 'Importing images...'
            },
            importAbortController: null
        });

        render(<ActivityDock />);

        expect(screen.getByText('Importing')).toBeTruthy();
        expect(screen.getByText('Importing images...')).toBeTruthy();
        expect(screen.queryByText('Cancel')).toBeNull();
    });

    it('aborts an import when cancel is clicked and a controller is registered', () => {
        const abortController = new AbortController();
        const abortSpy = vi.spyOn(abortController, 'abort');
        useLibraryStore.setState({
            isImporting: true,
            importProgress: {
                current: 1,
                total: 5,
                message: 'Importing images...'
            },
            importAbortController: abortController
        });

        render(<ActivityDock />);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        expect(abortSpy).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().isImporting).toBe(false);
        expect(useLibraryStore.getState().importProgress).toBeNull();
        expect(useLibraryStore.getState().importAbortController).toBeNull();
    });

    it('keeps stale import run progress out of the visible dock', () => {
        const runId = useLibraryStore.getState().beginImportRun({
            owner: 'folder-import',
            abortController: new AbortController(),
            progress: {
                current: 1,
                total: 10,
                message: 'Importing images from 3 folders...'
            }
        });
        expect(runId).toBeTruthy();
        useLibraryStore.getState().setImportProgressForRun('old-run', {
            current: 9,
            total: 10,
            message: 'Scanning C:/old-folder...'
        });

        render(<ActivityDock />);

        expect(screen.getByText('Importing images from 3 folders...')).toBeTruthy();
        expect(screen.queryByText('Scanning C:/old-folder...')).toBeNull();
    });

    it('renders running smart thumbnail progress without repeated checked counts', () => {
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingProgress: {
                current: 340,
                total: 0,
                message: 'Optimized 340 thumbnails'
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Smart Thumbnails')).toBeTruthy();
        expect(screen.getByText('Optimized 340 thumbnails')).toBeTruthy();
        expect(screen.getByText('Runs at low priority and throttles while you browse.')).toBeTruthy();
        expect(screen.queryByText('340 checked')).toBeNull();
        expect(screen.queryByText('340 / 340')).toBeNull();
        expect(screen.queryByText('0%')).toBeNull();
        expect(screen.queryByText('100%')).toBeNull();
        expect(screen.queryByText('Cancel')).toBeNull();
    });

    it('renders completed smart thumbnail progress without generic count or percent chrome', () => {
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingProgress: {
                current: 340,
                total: 340,
                message: 'Finished: 340 thumbnails optimized'
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Smart Thumbnails')).toBeTruthy();
        expect(screen.getByText('Finished: 340 thumbnails optimized')).toBeTruthy();
        expect(screen.getByText('Library thumbnails are up to date.')).toBeTruthy();
        expect(screen.queryByText('340 checked')).toBeNull();
        expect(screen.queryByText('340 / 340')).toBeNull();
        expect(screen.queryByText('100%')).toBeNull();
    });

    it('renders smart thumbnail failure footer when files need attention', () => {
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingProgress: {
                current: 340,
                total: 0,
                message: 'Optimized 338 thumbnails; 2 need attention'
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Optimized 338 thumbnails; 2 need attention')).toBeTruthy();
        expect(screen.getByText('Some files may be corrupt or unavailable.')).toBeTruthy();
    });

    it('renders indeterminate discovery progress without a misleading percentage', () => {
        useLibraryStore.setState({
            isScanningDiscovery: true,
            discoveryScanProgress: {
                current: 0,
                total: 0,
                message: 'Updating local asset index...',
                mode: 'indeterminate',
                detail: '718 model files found | 718 new/changed | 388 thumbnails linked',
                startedAt: Date.now()
            },
            isBackgroundHealingActive: true,
            backgroundHealingProgress: {
                current: 25,
                total: 100,
                message: 'Optimizing thumbnails...'
            }
        });

        const { container } = render(<ActivityDock />);

        expect(screen.getByText('Discovery Scan')).toBeTruthy();
        expect(screen.getByText('Updating local asset index...')).toBeTruthy();
        expect(screen.getByText('718 model files found')).toBeTruthy();
        expect(screen.getByText('718 new/changed')).toBeTruthy();
        expect(screen.getByText('388 thumbnails linked')).toBeTruthy();
        expect(screen.queryByText('718 model files found | 718 new/changed | 388 thumbnails linked')).toBeNull();
        expect(screen.queryByText('Smart Thumbnails')).toBeNull();
        expect(screen.queryByText('0 / 100')).toBeNull();
        expect(screen.queryByText('0%')).toBeNull();
        expect(screen.queryByText('100%')).toBeNull();
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(container.querySelector('.bg-gradient-to-r')).toBeTruthy();
    });

    it('renders determinate discovery progress with real counts', () => {
        useLibraryStore.setState({
            isScanningDiscovery: true,
            discoveryScanProgress: {
                current: 7,
                total: 20,
                message: 'Registering discovered assets...',
                mode: 'determinate',
                detail: 'model.safetensors'
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Discovery Scan')).toBeTruthy();
        expect(screen.getByText('7 / 20')).toBeTruthy();
        expect(screen.getByText('35%')).toBeTruthy();
        expect(screen.getByText('Registering discovered assets...')).toBeTruthy();
        expect(screen.getByText('model.safetensors')).toBeTruthy();
    });

    it('hides elapsed time when discovery progress is determinate', () => {
        useLibraryStore.setState({
            isScanningDiscovery: true,
            discoveryScanProgress: {
                current: 120,
                total: 718,
                message: 'Updating local asset index...',
                mode: 'determinate',
                detail: '97 indexed',
                startedAt: Date.now() - 6500
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Discovery Scan')).toBeTruthy();
        expect(screen.getByText('120 / 718')).toBeTruthy();
        expect(screen.getByText('17%')).toBeTruthy();
        expect(screen.getByText('Updating local asset index...')).toBeTruthy();
        expect(screen.getByText('97 indexed')).toBeTruthy();
        expect(screen.queryByText(/\d+s elapsed/)).toBeNull();
    });

    it('renders elapsed time for long-running discovery work', () => {
        useLibraryStore.setState({
            isScanningDiscovery: true,
            discoveryScanProgress: {
                current: 37,
                total: 0,
                message: 'Scanning resource folders...',
                mode: 'indeterminate',
                detail: '37 model files found | 1842 files checked',
                startedAt: Date.now() - 6500
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('37 model files found')).toBeTruthy();
        expect(screen.getByText('1842 files checked')).toBeTruthy();
        expect(screen.getByText(/\d+s elapsed/)).toBeTruthy();
        expect(screen.queryByText(/37 model files found \| 1842 files checked/)).toBeNull();
        expect(screen.queryByText('0%')).toBeNull();
    });

    it('renders discovery completion without cancel or percent noise', () => {
        useLibraryStore.setState({
            isScanningDiscovery: true,
            discoveryScanProgress: {
                current: 149,
                total: 149,
                message: 'Resource scan complete',
                mode: 'complete',
                detail: '149 model files found | 12 thumbnails linked',
                startedAt: Date.now() - 2000
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Discovery Scan')).toBeTruthy();
        expect(screen.getByText('Resource scan complete')).toBeTruthy();
        expect(screen.getByText('149 model files found')).toBeTruthy();
        expect(screen.getByText('12 thumbnails linked')).toBeTruthy();
        expect(screen.queryByText('149 model files found | 12 thumbnails linked')).toBeNull();
        expect(screen.queryByText('Cancel')).toBeNull();
        expect(screen.queryByText('149 / 149')).toBeNull();
        expect(screen.queryByText('100%')).toBeNull();
    });

    it('renders a unified Live Watch card without cancel controls during active live work', () => {
        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Preparing live InvokeAI sync...',
            progress: { current: 0, total: 0, message: undefined }
        });

        const { container } = render(<ActivityDock />);
        const card = container.querySelector('[layoutid="dock-content"]');
        const progressFill = container.querySelector('.bg-violet-400');

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('Preparing live InvokeAI sync...')).toBeTruthy();
        expect(screen.queryByText('Syncing')).toBeNull();
        expect(screen.queryByText('Cancel')).toBeNull();
        expect(screen.queryByText('0 / 0')).toBeNull();
        expect(card?.className).toContain('w-[min(400px,calc(100vw-2rem))]');
        expect(progressFill).toBeTruthy();
        expect(container.querySelector('.text-sage-600')).toBeNull();
    });

    it('keeps the same Live Watch card through summary updates', () => {
        const { container } = render(<ActivityDock />);

        act(() => {
            useLibraryStore.getState().startLiveWatchSession('generic', {
                phase: 'importing',
                message: 'Importing live images...',
                progress: { current: 1, total: 2, message: undefined }
            });
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('Importing live images...')).toBeTruthy();

        act(() => {
            useLibraryStore.getState().reportLiveImagesReceived(2, { source: 'generic' });
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('2 images received this session. Watching for more...')).toBeTruthy();
        expect(screen.queryByText('Syncing')).toBeNull();
        expect(screen.queryByText('Cancel')).toBeNull();
        expect(screen.getByText('Live Watch stays active in the background.')).toBeTruthy();
        expect(container.querySelector('.bg-violet-400')).toBeTruthy();
        expect(container.querySelector('.bg-gradient-to-r')).toBeNull();
    });
});
