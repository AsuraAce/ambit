import * as React from 'react';
import { act, fireEvent, render, screen } from '../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityDock } from '../ActivityDock';
import { createInitialLiveWatchSessionState, useLibraryStore } from '../../../stores/libraryStore';
import { invoke } from '@tauri-apps/api/core';

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

    afterEach(() => {
        vi.useRealTimers();
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

    it('renders running smart thumbnail progress with cancel controls and without repeated checked counts', () => {
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
        expect(screen.getByText('Cancel')).toBeTruthy();
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

    it('renders metadata refresh progress without duplicate count chrome and can cancel', () => {
        vi.mocked(invoke).mockResolvedValue(undefined);
        useLibraryStore.setState({
            isRefreshingMetadata: true,
            refreshProgress: {
                current: 126700,
                total: 288222,
                updated: 123981,
                errors: 0,
                phase: 'processing',
                message: 'Processed 126700/288222 (Updated: 123981). Timings: Fetch 54ms'
            }
        });

        render(<ActivityDock />);

        expect(screen.getByText('Metadata Refresh')).toBeTruthy();
        expect(screen.getByText('126,700 / 288,222 images | 44% | 123,981 updated')).toBeTruthy();
        expect(screen.queryByText('Refreshing Metadata')).toBeNull();
        expect(screen.queryByText('126,700 / 288,222')).toBeNull();
        expect(screen.queryByText(/Processed 126700/)).toBeNull();
        expect(screen.queryByText('44%')).toBeNull();

        fireEvent.click(screen.getByText('Cancel'));

        expect(invoke).toHaveBeenCalledWith('cancel_reparse_job');
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

    it('keeps Live Watch watching phase out of the dock', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'watching',
            message: 'Checking InvokeAI for completed images...'
        });

        render(<ActivityDock />);

        expect(screen.queryByText('Live Watch')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();
        expect(screen.queryByText('Checking InvokeAI for completed images...')).toBeNull();
        expect(screen.queryByTestId('activity-dock-progress-rail')).toBeNull();
    });

    it('keeps quick InvokeAI live sync hidden when it settles before the reveal delay', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...',
            progress: { current: 0, total: 0, message: undefined }
        });

        render(<ActivityDock />);

        act(() => {
            vi.advanceTimersByTime(2499);
        });

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'summary',
                message: 'Watching for new images...',
                progress: null
            });
        });

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();
        expect(screen.queryByText('Updating your library...')).toBeNull();
        expect(screen.queryByText('Watching for new images...')).toBeNull();
    });

    it('keeps zero-result and image-result summaries out of the dock', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...'
        });

        render(<ActivityDock />);

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'summary',
                message: 'Watching for new images...',
                progress: null
            });
        });

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();
        expect(screen.queryByText('Watching for new images...')).toBeNull();

        act(() => {
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'Syncing completed InvokeAI images...'
            });
            useLibraryStore.getState().reportLiveImagesReceived(2, { source: 'invoke' });
        });

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();
        expect(screen.queryByText('2 images added this session.')).toBeNull();
        expect(screen.queryByTestId('live-watch-compact-result')).toBeNull();
        expect(screen.queryByTestId('activity-dock-progress-rail')).toBeNull();
        expect(screen.queryByText('100%')).toBeNull();
    });

    it('reveals sustained InvokeAI Live Watch sync with stable user-facing copy', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...',
            progress: { current: 0, total: 0, message: undefined }
        });

        const { container } = render(<ActivityDock />);

        act(() => {
            vi.advanceTimersByTime(2499);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(1);
        });

        const card = container.querySelector('[layoutid="dock-content"]');

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('InvokeAI')).toBeTruthy();
        expect(screen.getByText('Updating your library...')).toBeTruthy();
        expect(screen.queryByText('Syncing')).toBeNull();
        expect(screen.queryByText('Checking')).toBeNull();
        expect(screen.queryByText('Importing')).toBeNull();
        expect(screen.queryByText('Syncing completed InvokeAI images...')).toBeNull();
        expect(screen.queryByText('Background Activity')).toBeNull();
        expect(screen.queryByText('Cancel')).toBeNull();
        expect(screen.queryByText('0 / 0')).toBeNull();
        expect(card?.className).toContain('w-[min(400px,calc(100vw-2rem))]');
        expect(screen.getByTestId('activity-dock-progress-rail')).toBeTruthy();
        expect(container.querySelector('.bg-gradient-to-r')).toBeTruthy();
        expect(container.querySelector('.bg-sage-500')).toBeTruthy();
        expect(container.querySelector('.text-sage-600')).toBeTruthy();
        expect(container.innerHTML).not.toContain('signal');
        expect(container.querySelector('.bg-violet-400')).toBeNull();
        expect(container.innerHTML).not.toContain('amethyst');
    });

    it('reveals sustained folder Live Watch import and keeps source context stable', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const { container } = render(<ActivityDock />);

        act(() => {
            useLibraryStore.getState().startLiveWatchSession('generic', {
                phase: 'importing',
                message: 'Importing new images...',
                progress: { current: 1, total: 3, message: undefined }
            });
        });

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('Folders')).toBeTruthy();
        expect(screen.getByText('Updating your library...')).toBeTruthy();

        act(() => {
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'Syncing completed InvokeAI images...',
                progress: { current: 0, total: 0, message: undefined }
            });
        });

        expect(screen.getByText('Mixed')).toBeTruthy();
        expect(screen.queryByText('Folders')).toBeNull();
        expect(screen.getByText('Updating your library...')).toBeTruthy();
        expect(container.querySelector('.bg-sage-500')).toBeTruthy();
        expect(container.innerHTML).not.toContain('signal');
        expect(container.innerHTML).not.toContain('violet');
        expect(container.innerHTML).not.toContain('amethyst');
    });

    it('keeps visible Live Watch copy stable across active sync and import phase changes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...'
        });

        render(<ActivityDock />);

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(screen.getByText('Updating your library...')).toBeTruthy();

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'syncing',
                message: 'Syncing completed InvokeAI images...',
                progress: { current: 0, total: 0, message: undefined }
            });
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'importing',
                message: 'Importing new images...',
                progress: { current: 1, total: 3, message: undefined }
            });
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('InvokeAI')).toBeTruthy();
        expect(screen.getByText('Updating your library...')).toBeTruthy();
        expect(screen.queryByText('Checking InvokeAI for completed images...')).toBeNull();
        expect(screen.queryByText('Syncing completed InvokeAI images...')).toBeNull();
        expect(screen.queryByText('Importing new images...')).toBeNull();
        expect(screen.queryByText('Syncing')).toBeNull();
        expect(screen.queryByText('Importing')).toBeNull();
    });

    it('keeps Live Watch visible through close grace after sustained work settles', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...'
        });

        render(<ActivityDock />);

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('Updating your library...')).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(2200);
        });

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'summary',
                message: 'Watching for new images...',
                progress: null
            });
        });

        act(() => {
            vi.advanceTimersByTime(1499);
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();
    });

    it('respects the minimum visible time when sustained work settles immediately after reveal', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...',
            progress: { current: 0, total: 0, message: undefined }
        });

        render(<ActivityDock />);

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'summary',
                message: 'Watching for new images...',
                progress: null
            });
        });

        act(() => {
            vi.advanceTimersByTime(2199);
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();
    });

    it('keeps dismissed Live Watch hidden for the current presentation but allows a later sustained batch', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...'
        });

        render(<ActivityDock />);

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        fireEvent.click(screen.getByTitle('Dismiss'));
        expect(screen.queryByText('Live Watch')).toBeNull();

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'syncing',
                message: 'Still syncing...',
                progress: { current: 1, total: 2, message: undefined }
            });
        });

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(screen.queryByText('Live Watch')).toBeNull();

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'summary',
                message: 'Watching for new images...',
                progress: null
            });
        });

        act(() => {
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'Syncing completed InvokeAI images...'
            });
        });

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();
        expect(screen.getByText('Updating your library...')).toBeTruthy();
    });

    it('lets higher-priority work replace visible Live Watch immediately', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...'
        });

        render(<ActivityDock />);

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(screen.getByText('Live Watch')).toBeTruthy();

        act(() => {
            useLibraryStore.setState({
                isImporting: true,
                importProgress: {
                    current: 1,
                    total: 2,
                    message: 'Importing selected files...'
                }
            });
        });

        expect(screen.getByText('Background Activity')).toBeTruthy();
        expect(screen.getByText('Importing selected files...')).toBeTruthy();
        expect(screen.queryByText('InvokeAI')).toBeNull();
        expect(screen.queryByText('Updating your library...')).toBeNull();
    });

    it('keeps higher-priority work in control while Live Watch watching remains ambient', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'watching',
            message: 'Checking InvokeAI for completed images...'
        });

        render(<ActivityDock />);

        act(() => {
            useLibraryStore.setState({
                isImporting: true,
                importProgress: {
                    current: 1,
                    total: 2,
                    message: 'Importing selected files...'
                }
            });
        });

        expect(screen.getByText('Background Activity')).toBeTruthy();
        expect(screen.getByText('Importing selected files...')).toBeTruthy();
        expect(screen.queryByText('InvokeAI')).toBeNull();
        expect(screen.queryByText('Updating your library...')).toBeNull();
    });

    it('renders thumbnail regeneration and cancels it', () => {
        const abortController = new AbortController();
        const abort = vi.spyOn(abortController, 'abort');
        useLibraryStore.setState({
            isRegeneratingThumbnails: true,
            thumbnailProgress: { current: 3, total: 10, message: 'Regenerating thumbnails...' },
            thumbnailAbortController: abortController
        });
        render(<ActivityDock />);
        expect(screen.getByText('Optimizing')).toBeTruthy();
        fireEvent.click(screen.getByText('Cancel'));
        expect(abort).toHaveBeenCalledOnce();
        expect(useLibraryStore.getState().isRegeneratingThumbnails).toBe(false);
    });

    it('renders model resolution and cancels the backend job', async () => {
        vi.mocked(invoke).mockResolvedValue(undefined);
        useLibraryStore.setState({
            isResolvingModels: true,
            modelResolutionProgress: { current: 4, total: 8, message: 'Resolving model hashes...' }
        });
        render(<ActivityDock />);
        expect(screen.getByText('Resolving Models')).toBeTruthy();
        fireEvent.click(screen.getByText('Cancel'));
        expect(useLibraryStore.getState().isResolvingModels).toBe(false);
        expect(invoke).toHaveBeenCalled();
    });

    it('renders indeterminate smart fill without cancel controls', () => {
        useLibraryStore.setState({ isPopulatingThumbnails: true });
        render(<ActivityDock />);
        expect(screen.getByText('Smart Fill')).toBeTruthy();
        expect(screen.getByText('Matching images to models...')).toBeTruthy();
        expect(screen.queryByText('Cancel')).toBeNull();
    });

    it('minimizes and expands high- and low-priority activities', () => {
        useLibraryStore.setState({
            syncStatus: 'syncing',
            syncProgress: { current: 1, total: 4, message: 'Syncing' }
        });
        const view = render(<ActivityDock />);
        fireEvent.click(screen.getByTitle('Minimize'));
        expect(screen.getByTitle('Click to expand details')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Click to expand details'));
        expect(screen.getAllByText('Syncing')).toHaveLength(2);

        view.unmount();
        resetLibraryStore();
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingProgress: { current: 1, total: 4, message: 'Healing' },
            isActivityDockMinimized: true
        });
        const { container } = render(<ActivityDock />);
        expect(container.querySelector('.bg-violet-500')).toBeTruthy();
    });

    it('dismisses ordinary activity until the store reopens it', () => {
        useLibraryStore.setState({
            syncStatus: 'syncing',
            syncProgress: { current: 1, total: 2, message: 'Syncing' }
        });
        render(<ActivityDock />);
        fireEvent.click(screen.getByTitle('Dismiss'));
        expect(screen.queryByText('Background Activity')).toBeNull();
        expect(useLibraryStore.getState().isActivityDockDismissed).toBe(true);
    });

    it.each([
        ['discovery', { isScanningDiscovery: true, discoveryScanProgress: { current: 1, total: 2, message: 'Discovery' } }],
        ['duplicates', { isScanningDuplicates: true, duplicateScanProgress: { current: 1, total: 2, message: 'Duplicates' } }],
        ['missing', { isScanningMissingFiles: true, missingScanProgress: { current: 1, total: 2, message: 'Missing' } }],
    ] as const)('dispatches %s scan cancellation', (_name, state) => {
        useLibraryStore.setState(state);
        render(<ActivityDock />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(useLibraryStore.getState().isScanningDiscovery || useLibraryStore.getState().isScanningDuplicates || useLibraryStore.getState().isScanningMissingFiles).toBe(false);
    });

    it('cancels background thumbnail optimization', () => {
        vi.mocked(invoke).mockResolvedValue(undefined);
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingProgress: { current: 1, total: 0, message: 'Healing' }
        });
        render(<ActivityDock />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(invoke).toHaveBeenCalled();
    });

    it('formats long elapsed times and updates them on the interval', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:02:05Z'));
        useLibraryStore.setState({
            isScanningDiscovery: true,
            discoveryScanProgress: {
                current: 1,
                total: 0,
                message: 'Scanning',
                mode: 'indeterminate',
                startedAt: Date.now() - 65000
            }
        });
        render(<ActivityDock />);
        expect(screen.getByText('1m 5s elapsed')).toBeTruthy();
        act(() => vi.advanceTimersByTime(55000));
        expect(screen.getByText('2m elapsed')).toBeTruthy();
    });

    it.each([
        [null, 'Preparing metadata refresh...'],
        [{ current: 0, total: 0, phase: 'counting' }, 'counting'],
        [{ current: 0, total: 0, message: 'Preparing' }, 'Preparing'],
        [{ current: 5, total: 10, updated: 2, errors: 1 }, '5 / 10 images | 50% | 2 updated | 1 errors'],
    ] as const)('formats metadata refresh fallback progress', (refreshProgress, expected) => {
        useLibraryStore.setState({ isRefreshingMetadata: true, refreshProgress });
        render(<ActivityDock />);
        expect(screen.getByText(expected)).toBeTruthy();
    });

    it('shows the generic Live Watch source when no source is known', () => {
        vi.useFakeTimers();
        useLibraryStore.setState({
            liveWatchSession: {
                ...createInitialLiveWatchSessionState(),
                active: true,
                source: null,
                phase: 'syncing'
            }
        });
        render(<ActivityDock />);
        act(() => vi.advanceTimersByTime(2500));
        expect(screen.getByText('Watch')).toBeTruthy();
    });

    it('minimizes visible Live Watch without the low-priority pulse class', () => {
        vi.useFakeTimers();
        useLibraryStore.getState().startLiveWatchSession('invoke', { phase: 'syncing' });
        const { container } = render(<ActivityDock />);
        act(() => vi.advanceTimersByTime(2500));
        fireEvent.click(screen.getByTitle('Minimize'));
        expect(screen.getByTitle('Click to expand details')).toBeTruthy();
        expect(container.querySelector('.animate-pulse')).toBeNull();
    });

    it('omits updated metadata counts when the backend has not supplied them', () => {
        useLibraryStore.setState({
            isRefreshingMetadata: true,
            refreshProgress: { current: 2, total: 4, errors: 0 }
        });
        render(<ActivityDock />);
        expect(screen.getByText('2 / 4 images | 50%')).toBeTruthy();
    });

    it('uses the starting fallback for activity without a message or phase', () => {
        useLibraryStore.setState({
            syncStatus: 'syncing',
            syncProgress: { current: 0, total: 0 }
        });
        render(<ActivityDock />);
        expect(screen.getByText('Starting work...')).toBeTruthy();
    });

    it('cancels manual synchronization from the dock', () => {
        const abortController = new AbortController();
        useLibraryStore.setState({
            syncStatus: 'syncing',
            syncProgress: { current: 1, total: 2, message: 'Syncing' },
            syncAbortController: abortController
        });
        render(<ActivityDock />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(useLibraryStore.getState().syncStatus).toBe('idle');
    });
});
