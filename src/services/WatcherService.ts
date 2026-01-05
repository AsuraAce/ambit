import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { AppSettings } from '../types';

type WatcherCallback = () => void;

export class WatcherService {
    private unlistenFn: UnlistenFn | null = null;
    private isWatching = false;

    async startWatching(paths: string[], onChangeEvent: WatcherCallback) {
        if (this.isWatching) await this.stopWatching();

        this.isWatching = true;

        if (paths.length === 0) return;

        try {
            // Start the native rust watcher which handles multiple paths
            await unwrap(commands.startNativeFolderWatcher(paths));
            console.log(`[WatcherService] Native watcher started for ${paths.length} paths`);

            // Listen for the debounced event from Rust
            this.unlistenFn = await listen('folder-change-event', () => {
                console.log('[WatcherService] Folder change detected');
                onChangeEvent();
            });

        } catch (err) {
            console.error(`[WatcherService] Failed to start native watcher:`, err);
        }
    }

    async stopWatching() {
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
