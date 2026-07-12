import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { useLibraryStore } from '../../../../stores/libraryStore';
import { GeneralTab } from '../GeneralTab';
import type { AppSettings } from '../../../../types';

const mockAddToast = vi.fn();
vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast
    })
}));

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    autoCheckForUpdates: true,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    enableAutoThumbnailHealing: true,
    enforceHighQualityThumbnails: false,
    thumbnailOptimizationProfile: 'balanced',
    logLevel: 'info',
    ...overrides
});

describe('GeneralTab Smart Thumbnail details', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(invoke).mockReset();
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    });

    it('renders active optimizer status and metrics without an ETA', () => {
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingPaused: false,
            backgroundHealingDetails: {
                checked: 1489,
                optimized: 1489,
                reused: 233,
                failed: 2,
                skipped: 11,
                imagesPerSecond: 12.4,
                batchMs: 210,
                dbMs: 32,
                encodeMs: 1120,
                profile: 'balanced',
                phase: 'throttled',
                isThrottled: true
            }
        });

        render(<GeneralTab settings={createSettings()} setSettings={vi.fn()} />);

        expect(screen.getByText('Smart Thumbnail Status')).toBeTruthy();
        expect(screen.getByText('Throttled')).toBeTruthy();
        expect(screen.getByText(/Speed\s+12\/s/)).toBeTruthy();
        expect(screen.getByText(/Optimized\s+1,489/)).toBeTruthy();
        expect(screen.getByText(/Reused\s+233/)).toBeTruthy();
        expect(screen.getByText(/Failed\s+2/)).toBeTruthy();
        expect(screen.getByText(/Skipped\s+11/)).toBeTruthy();
        expect(screen.queryByText(/eta/i)).toBeNull();
    });

    it('explains the CPU and responsiveness tradeoff between background speed profiles', () => {
        render(<GeneralTab settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.focus(screen.getByRole('button', { name: 'About background thumbnail speed' }));

        expect(screen.getByRole('tooltip').textContent).toContain('Quiet minimizes CPU use');
        expect(screen.getByRole('tooltip').textContent).toContain('Fast prioritizes completion speed');
    });

    it('does not expose File Link Audit even when developer mode is enabled', () => {
        render(<GeneralTab settings={createSettings({ devMode: true })} setSettings={vi.fn()} />);

        expect(screen.queryByText(/file link audit/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /run audit/i })).toBeNull();
    });

    it('keeps the last completed run visible when the optimizer is idle', () => {
        useLibraryStore.setState({
            isBackgroundHealingActive: false,
            backgroundHealingPaused: false,
            backgroundHealingDetails: null,
            lastBackgroundHealingRun: {
                checked: 25000,
                optimized: 25000,
                reused: 0,
                failed: 0,
                skipped: 0,
                imagesPerSecond: 59.52,
                durationMs: 420000,
                completedAt: 1777824000000,
                profile: 'fast'
            }
        });

        render(<GeneralTab settings={createSettings()} setSettings={vi.fn()} />);

        expect(screen.getByText('Idle')).toBeTruthy();
        expect(screen.getByText(/Last run\s+7m 0s/)).toBeTruthy();
        expect(screen.getByText(/Speed\s+60\/s/)).toBeTruthy();
        expect(screen.getByText(/Optimized\s+25,000/)).toBeTruthy();
        expect(screen.queryByText(/eta/i)).toBeNull();
    });

    it('lazy loads failed thumbnail details and retries all failures', async () => {
        vi.mocked(invoke)
            .mockResolvedValueOnce({
                failures: [
                    {
                        id: 'img-failed',
                        path: 'C:/library/failed-image.png',
                        thumbnailPath: 'C:/thumbs/failed-image.webp',
                        failureCount: 2,
                        lastError: 'Failed to decode image',
                        lastAttemptAt: 1777824000000
                    }
                ]
            })
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce({ failures: [] });

        useLibraryStore.setState({
            isBackgroundHealingActive: false,
            backgroundHealingPaused: false,
            backgroundHealingDetails: null,
            lastBackgroundHealingRun: {
                checked: 25000,
                optimized: 24993,
                reused: 0,
                failed: 1,
                skipped: 0,
                imagesPerSecond: 59.52,
                durationMs: 420000,
                completedAt: 1777824000000,
                profile: 'fast'
            }
        });

        const retrySignalBefore = useLibraryStore.getState().thumbnailOptimizationRetrySignal;
        render(<GeneralTab settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /view failures/i }));

        expect(await screen.findByText('failed-image.png')).toBeTruthy();
        expect(screen.getByText('Failed to decode image')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /retry all/i }));

        await waitFor(() => {
            expect(useLibraryStore.getState().thumbnailOptimizationRetrySignal).toBe(retrySignalBefore + 1);
        });
        expect(await screen.findByText('No thumbnail failures found.')).toBeTruthy();
        expect(invoke).toHaveBeenCalledWith('get_thumbnail_optimization_failures', { limit: 50 });
        expect(invoke).toHaveBeenCalledWith('retry_failed_thumbnail_optimizations');
    });

    it('can check persisted failures even when the current store has no failure count', async () => {
        vi.mocked(invoke).mockResolvedValueOnce({
            failures: [
                {
                    id: 'persisted-failure',
                    path: 'C:/library/persisted.png',
                    thumbnailPath: null,
                    failureCount: 1,
                    lastError: 'File unavailable',
                    lastAttemptAt: 1777824000000
                }
            ]
        });

        render(<GeneralTab settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /check failures/i }));

        expect(await screen.findByText('persisted.png')).toBeTruthy();
        expect(screen.getByText('File unavailable')).toBeTruthy();
        expect(invoke).toHaveBeenCalledWith('get_thumbnail_optimization_failures', { limit: 50 });
    });

    it('does not allow retry while the thumbnail optimizer is already running', async () => {
        vi.mocked(invoke).mockResolvedValueOnce({
            failures: [
                {
                    id: 'running-failure',
                    path: 'C:/library/running.png',
                    thumbnailPath: null,
                    failureCount: 1,
                    lastError: 'Decode failed',
                    lastAttemptAt: 1777824000000
                }
            ]
        });
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingPaused: false,
            backgroundHealingDetails: {
                checked: 10,
                optimized: 8,
                reused: 0,
                failed: 1,
                skipped: 0,
                imagesPerSecond: 2,
                batchMs: 0,
                dbMs: 0,
                encodeMs: 0,
                profile: 'balanced',
                phase: 'running',
                isThrottled: false
            }
        });

        render(<GeneralTab settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /view failures/i }));

        const retryButton = await screen.findByRole('button', { name: /retry all/i });
        expect(retryButton).toHaveProperty('disabled', true);
    });
});
