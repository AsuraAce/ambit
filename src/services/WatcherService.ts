import { watch, WatchEvent } from '@tauri-apps/plugin-fs';
import { AppSettings } from '../types';

type WatcherCallback = (event: WatchEvent) => void;

export class WatcherService {
    private unwatchFns: Map<string, () => void> = new Map();
    private isWatching = false;

    async startWatching(settings: AppSettings, onEvent: WatcherCallback) {
        if (this.isWatching) await this.stopWatching();

        this.isWatching = true;
        const folders = settings.monitoredFolders.filter(f => f.isActive);

        // Map folders to promises to initialize in parallel
        const watchPromises = folders.map(async (folder) => {
            try {
                // watch returns a promise that resolves to an unwatch function
                const unwatch = await watch(folder.path, (event) => {
                    onEvent(event);
                }, { recursive: true });

                if (this.isWatching) {
                    this.unwatchFns.set(folder.id, unwatch);
                    console.log(`Started watching: ${folder.path}`);
                } else {
                    // unexpected race condition, cleanup
                    unwatch();
                }
            } catch (err) {
                console.error(`Failed to watch ${folder.path}:`, err);
            }
        });

        // Wait for all watchers to initialize in parallel
        await Promise.all(watchPromises);
    }

    async stopWatching() {
        this.isWatching = false;
        for (const unwatch of this.unwatchFns.values()) {
            try {
                unwatch();
            } catch (e) {
                console.error('Error unwatching:', e);
            }
        }
        this.unwatchFns.clear();
        console.log('Stopped all watchers');
    }

    async updateWatcher(settings: AppSettings, onEvent: WatcherCallback) {
        // Simple restart strategy for now
        await this.startWatching(settings, onEvent);
    }
}

export const watcherService = new WatcherService();
