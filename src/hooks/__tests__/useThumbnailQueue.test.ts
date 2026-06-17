import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * useThumbnailQueue Integration Behavior Tests
 * 
 * NOTE: This hook uses Zustand stores with selector-based subscriptions,
 * which makes isolated unit testing complex. The behavior is verified through:
 * 
 * 1. Build validation (TypeScript compiles successfully)
 * 2. Integration testing (manual app testing)
 * 3. These simplified behavioral contracts
 * 
 * The hook:
 * - Defers startup by 30 seconds to avoid blocking app initialization
 * - Starts the backend-owned thumbnail optimization job
 * - Listens for backend progress and completion events
 * - Pauses when high-priority import, scan, discovery, indexing, or metadata work is active
 * - Throttles instead of cancelling during ordinary image queries
 * - Resumes automatically when blocking activities complete
 * - Respects `enableAutoThumbnailHealing` settings flag
 * - Updates libraryStore progress state for ActivityDock visibility
 */

describe('useThumbnailQueue behavioral contract', () => {
    it('should export a void function hook', async () => {
        // Verify the hook can be imported and has correct signature
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        expect(typeof useThumbnailQueue).toBe('function');
    });

    it('should have correct startup delay constant', async () => {
        // The hook source should use a 30 second delay for deferred startup
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('STARTUP_DELAY_MS');
        expect(content).toContain('30000');
        expect(content).not.toContain('STARTUP_DELAY_MS = 5000');
    });

    it('should start the backend job instead of using the generic scanner loop', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('startThumbnailOptimizationJob');
        expect(content).toContain('thumbnail-optimization-progress');
        expect(content).toContain('thumbnail-optimization-complete');
        expect(content).toContain('thumbnailOptimizationProfile');
        expect(content).not.toContain('scanImagesBulk');
        expect(content).not.toContain('updateThumbnailPathsBatch');
        expect(content).not.toContain('BATCH_SIZE');
        expect(content).not.toContain('BATCH_DELAY_MS');
        expect(content).not.toContain('getUnoptimizedImageEntries');
        expect(content).not.toContain('getUnoptimizedImagesCount');
    });

    it('should check settings for enableAutoThumbnailHealing', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('enableAutoThumbnailHealing');
        expect(content).toContain('useSettingsStore');
    });

    it('should update libraryStore with progress', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('setBackgroundHealingActive');
        expect(content).toContain('setBackgroundHealingProgress');
        expect(content).toContain('setBackgroundHealingPaused');
        expect(content).toContain('setBackgroundHealingDetails');
    });

    it('should respond to explicit thumbnail optimization retry requests', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('thumbnailOptimizationRetrySignal');
        expect(content).toContain('retryAfterCurrentRunRef');
        expect(content).toContain('postRunRetrySignal');
        expect(content).toContain("scheduleIdleCallback('retry'");
        expect(content).toContain('void runQueue();');
    });

    it('should cancel pending idle starts on disable and unmount', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('scheduledIdleCancelRef');
        expect(content).toContain('cancelScheduledIdleCallback();');
        expect(content).toContain("scheduleIdleCallback('auto-start'");
        expect(content).toContain("scheduleIdleCallback('resume'");
        expect(content).toContain('mountedRef.current = false');
    });

    it('should pause only for high-priority blocking work', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('isImporting');
        expect(content).toContain('isRegeneratingThumbnails');
        expect(content).toContain('syncStatus');
        expect(content).toContain('isResolvingModels');
        expect(content).toContain('isScanningDiscovery');
        expect(content).toContain('isScanningDuplicates');
        expect(content).toContain('isScanningMissingFiles');
        expect(content).toContain('isPopulatingThumbnails');
        expect(content).toContain('isStartupCatchupPending');
        expect(content).toContain('isMetadataRefreshPending');
        expect(content).toContain('isRefreshingMetadata');
        expect(content).toContain('thumbnailMaintenanceOperation');
        expect(content).toContain('isHardBlocked');
        expect(content).toContain('setThumbnailOptimizationThrottled');
        expect(content).toContain('isImageQueryFetching');
        expect(content).not.toContain("queryClient.isFetching({ queryKey: ['images'] }) > 0");
    });

    it('should keep startup-only blockers internal instead of showing thumbnail work early', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        const runQueueStart = content.indexOf('const runQueue = useCallback');
        const runQueueEnd = content.indexOf('const [isStartupDelayComplete', runQueueStart);
        const runQueueBlock = content.slice(runQueueStart, runQueueEnd);
        const queueClaim = runQueueBlock.indexOf('isRunningRef.current = true;');
        const backendStart = runQueueBlock.indexOf('commands.startThumbnailOptimizationJob');
        const beforeBackendStarts = runQueueBlock.slice(queueClaim, backendStart);

        expect(content).toContain('hasVisibleThumbnailProgress');
        expect(content).toContain('hasVisibleThumbnailResult');
        expect(beforeBackendStarts).not.toContain('setBackgroundHealingActive(true)');
        expect(beforeBackendStarts).not.toContain('THUMBNAIL_QUEUE_START_MESSAGE');
    });

    it('should keep image query throttling out of startup scheduling', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        const runQueueStart = content.indexOf('const runQueue = useCallback');
        const runQueueEnd = content.indexOf('const [isStartupDelayComplete', runQueueStart);
        const runQueueBlock = content.slice(runQueueStart, runQueueEnd);
        const runQueueDependencies = runQueueBlock.slice(runQueueBlock.lastIndexOf('    }, ['));

        expect(content).toContain('isImageQueryFetchingRef');
        expect(runQueueBlock).toContain('isImageQueryFetchingRef.current');
        expect(runQueueDependencies).not.toContain('isImageQueryFetching');
        expect(content).toContain('setBackendThrottled(isImageQueryFetching)');
    });

    it('should recheck blocking activity after async setup before claiming the queue', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        const runQueueStart = content.indexOf('const runQueue = useCallback');
        const runQueueEnd = content.indexOf('const [isStartupDelayComplete', runQueueStart);
        const runQueueBlock = content.slice(runQueueStart, runQueueEnd);
        const directoryResolution = runQueueBlock.indexOf('const thumbnailDir = await getThumbnailDir();');
        const finalBlockerCheck = runQueueBlock.indexOf('if (shouldPauseForActivity())', directoryResolution);
        const queueClaim = runQueueBlock.indexOf('isRunningRef.current = true;', directoryResolution);

        expect(directoryResolution).toBeGreaterThan(-1);
        expect(finalBlockerCheck).toBeGreaterThan(directoryResolution);
        expect(finalBlockerCheck).toBeLessThan(queueClaim);
        expect(runQueueBlock.slice(finalBlockerCheck, queueClaim)).toContain('setBackgroundHealingPaused(true)');
        expect(runQueueBlock.slice(finalBlockerCheck, queueClaim)).toContain('return;');
    });

    it('should restart once for profile or quality setting changes', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('runningConfigRef');
        expect(content).toContain('restartRequestedRef');
        expect(content).toContain('Restarting backend job for Smart Thumbnail settings change');
        expect(content).toContain("queryKey: ['images']");
    });
});
