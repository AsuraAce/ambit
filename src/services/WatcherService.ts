import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { AppSettings } from '../types';

type WatcherCallback = () => void;

export class WatcherService {
    private unlistenFn: UnlistenFn | null = null;
    private isWatching = false;

    async startWatching(settings: AppSettings, onChangeEvent: WatcherCallback) {
        if (this.isWatching) await this.stopWatching();

        this.isWatching = true;
        const folders = settings.monitoredFolders.filter(f => f.isActive).map(f => f.path);

        try {
            // Start the native rust watcher which handles multiple paths
            await invoke('start_native_folder_watcher', { paths: folders });
            console.log(`[WatcherService] Native watcher started for ${folders.length} paths`);

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
            await invoke('start_native_folder_watcher', { paths: [] });
            console.log('[WatcherService] Stopped native watcher');
        } catch (e) {
            console.error('Error stopping native watcher:', e);
        }
    }

    async updateWatcher(settings: AppSettings, onChangeEvent: WatcherCallback) {
        await this.startWatching(settings, onChangeEvent);
    }
}

export const watcherService = new WatcherService();
