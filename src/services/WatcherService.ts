import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { UnlistenFn } from '@tauri-apps/api/event';
import { AppSettings } from '../types';
import { isBrowserMockMode } from './runtime';
import { startBackgroundDiagnostic, type BackgroundDiagnosticHandle } from '../utils/backgroundDiagnostics';
import { listenWithCleanup } from '../utils/tauriListener';

type WatcherCallback = (paths?: string[]) => void;

export class WatcherService {
    private unlistenFn: UnlistenFn | null = null;
    private isWatching = false;
    private lastPaths: string[] = [];
    private generation = 0;
    private diagnostic: BackgroundDiagnosticHandle | null = null;

    async startWatching(paths: string[], onChangeEvent: WatcherCallback) {
        if (isBrowserMockMode()) {
            console.info('[WatcherService] Native watcher unavailable in browser mock mode; skipped start.', {
                pathCount: paths.length
            });
            return;
        }

        // Skip if already watching the exact same paths
        const pathsChanged = paths.length !== this.lastPaths.length ||
            paths.some((p, i) => p !== this.lastPaths[i]);

        if (this.isWatching && !pathsChanged) {
            console.debug('[WatcherService] Native watcher already active for requested paths; skipped restart.', {
                pathCount: paths.length
            });
            return;
        }

        if (this.isWatching) await this.stopWatching();

        if (paths.length === 0) {
            console.info('[WatcherService] Native watcher start skipped because no paths were configured.');
            return;
        }

        const startGeneration = ++this.generation;

        try {
            // Start the native rust watcher which handles multiple paths
            await unwrap(commands.startNativeFolderWatcher(paths));
            if (startGeneration !== this.generation) {
                console.info('[WatcherService] Native watcher start superseded before listener registration.', {
                    pathCount: paths.length
                });
                await unwrap(commands.startNativeFolderWatcher([]));
                return;
            }

            console.log(`[WatcherService] Native watcher started for ${paths.length} paths`);

            this.isWatching = true;
            this.lastPaths = [...paths];
            this.diagnostic = startBackgroundDiagnostic('job', 'Native folder watcher', {
                pathCount: paths.length,
                paths
            });

            // Listen for the debounced event from Rust
            const listener = listenWithCleanup<string[]>(
                'folder-change-event',
                (event) => {
                    const pathCount = event.payload?.length || 0;
                    console.log(`[WatcherService] Folder change detected with ${pathCount} paths`);
                    this.diagnostic?.update({ lastEventAt: Date.now(), lastPathCount: pathCount });
                    onChangeEvent(event.payload);
                },
                'Native folder watcher events'
            );
            this.unlistenFn = listener.cleanup;

            const listenerReady = await listener.ready;
            if (startGeneration !== this.generation) {
                console.info('[WatcherService] Native watcher start superseded after listener registration.', {
                    pathCount: paths.length
                });
                listener.cleanup();
                return;
            }

            if (!listenerReady) {
                await this.stopWatching();
            }

        } catch (err) {
            console.error('[WatcherService] Failed to start native watcher:', {
                pathCount: paths.length
            }, err);
            this.diagnostic?.finish('failed', { error: err instanceof Error ? err.message : String(err) });
            this.diagnostic = null;
            this.isWatching = false;
            this.lastPaths = [];
            // Optionally throw here so the UI can display a Toast, or just leave `isWatching = false` 
            // so we can try again later.
        }
    }

    async stopWatching() {
        if (isBrowserMockMode()) {
            this.isWatching = false;
            this.lastPaths = [];
            return;
        }

        const hadActiveWatcher = Boolean(this.unlistenFn) || this.isWatching;
        this.generation++;

        if (!hadActiveWatcher) return;

        this.isWatching = false;
        this.lastPaths = [];

        if (this.unlistenFn) {
            this.unlistenFn();
            this.unlistenFn = null;
        }
        this.diagnostic?.finish('cancelled');
        this.diagnostic = null;

        try {
            // Send empty list to stop the rust watcher
            await unwrap(commands.startNativeFolderWatcher([]));
            console.log('[WatcherService] Stopped native watcher');
        } catch (e) {
            console.error('[WatcherService] Failed to stop native watcher:', e);
        }
    }

    async updateWatcher(paths: string[], onChangeEvent: WatcherCallback) {
        await this.startWatching(paths, onChangeEvent);
    }
}

export const watcherService = new WatcherService();
