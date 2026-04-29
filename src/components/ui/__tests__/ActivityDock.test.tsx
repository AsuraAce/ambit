import * as React from 'react';
import { act, render, screen } from '../../../test/testUtils';
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
        expect(card?.className).toContain('w-[min(360px,calc(100vw-2rem))]');
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
