import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { AppSettings } from '../types';
import { isBrowserMockMode } from './runtime';

type WatcherCallback = (paths?: string[]) => void;

export class WatcherService {
    private unlistenFn: UnlistenFn | null = null;
    private isWatching = false;
    private lastPaths: string[] = [];

    async startWatching(paths: string[], onChangeEvent: WatcherCallback) {
        if (isBrowserMockMode()) {
            console.info('[WatcherService] Native watcher unavailable in browser mock mode.');
            return;
        }

        // Skip if already watching the exact same paths
        const pathsChanged = paths.length !== this.lastPaths.length ||
            paths.some((p, i) => p !== this.lastPaths[i]);

        if (this.isWatching && !pathsChanged) return;

        if (this.isWatching) await this.stopWatching();

        if (paths.length === 0) return;

        try {
            // Start the native rust watcher which handles multiple paths
            await unwrap(commands.startNativeFolderWatcher(paths));
            console.log(`[WatcherService] Native watcher started for ${paths.length} paths`);

            this.isWatching = true;
            this.lastPaths = [...paths];

            // Listen for the debounced event from Rust
            this.unlistenFn = await listen<string[]>('folder-change-event', (event) => {
                console.log(`[WatcherService] Folder change detected with ${event.payload?.length || 0} paths`);
                onChangeEvent(event.payload);
            });

        } catch (err) {
            console.error(`[WatcherService] Failed to start native watcher:`, err);
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

        if (!this.unlistenFn && !this.isWatching) return;

        this.isWatching = false;

        if (this.unlistenFn) {
            this.unlistenFn();
            this.unlistenFn = null;
        }

        try {
            // Send empty list to stop the rust watcher
            await unwrap(commands.startNativeFolderWatcher([]));
            console.log('[WatcherService] Stopped native watcher');
        } catch (e) {
            console.error('Error stopping native watcher:', e);
        }
    }

    async updateWatcher(paths: string[], onChangeEvent: WatcherCallback) {
        await this.startWatching(paths, onChangeEvent);
    }
}

export const watcherService = new WatcherService();
