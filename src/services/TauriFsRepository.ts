import { BaseDirectory, readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { AppState, IRepository } from './repository';
import { INITIAL_COLLECTIONS } from '../constants';
import { createDefaultAppSettings } from '../constants/defaultSettings';

export class TauriFsRepository implements IRepository {
    private fileName = 'library.json';
    private hasLoggedDirectoryError = false;

    // Use AppLocalData to store in Local AppData (Windows) or appropriate local path
    private baseDir = BaseDirectory.AppLocalData;

    private async ensureDirectory() {
        try {
            await mkdir('', { baseDir: this.baseDir, recursive: true });
        } catch (e) {
            if (!this.hasLoggedDirectoryError) {
                this.hasLoggedDirectoryError = true;
                console.error('Error ensuring directory:', e);
            }
        }
    }

    async load(): Promise<AppState> {
        try {
            await this.ensureDirectory();
            const fileExists = await exists(this.fileName, { baseDir: this.baseDir });

            if (fileExists) {
                const content = await readTextFile(this.fileName, { baseDir: this.baseDir });
                const saved = JSON.parse(content);

                // Migration/Merge logic from LocalStorageRepository
                // OPTIMIZATION: If we find images in the JSON, it means we have a legacy bloated file.
                // We should strip them (since we use SQLite now) and re-save to fix startup time.
                if (saved.images && Array.isArray(saved.images) && saved.images.length > 0) {
                    console.log('[TauriFsRepository] Detected legacy images in library.json. Cleaning up to improve startup...');
                    // We don't await this so we don't block the return, but it will fix the file for next time.
                    void this.save({ ...saved, images: [] });
                }

                return {
                    ...saved,
                    images: [], // Always return empty images from JSON, we rely on SQLite
                    settings: createDefaultAppSettings({
                        hasCompletedOnboarding: true,
                        maskedKeywords: [],
                        libraryShowGrids: false,
                        resourceFolders: [],
                        ...saved.settings
                    })
                };
            }
        } catch (err) {
            console.error('Failed to load state from filesystem:', err);
        }

        return this.getDefaultState();
    }

    /**
     * NOTE on Security: library.json contains non-sensitive AppSettings.
     * Sensitive secrets like API keys are stored in the OS-native secure keyring
     * (via the `keyring` crate in Rust) and are not persisted in this file.
     */
    async save(state: AppState): Promise<void> {
        try {
            await this.ensureDirectory();
            // OPTIMIZATION: Do not save images to JSON. They are in SQLite.
            // This prevents the file from growing to MBs/GBs and blocking startup.
            const stateToSave = { ...state, images: [] };
            const serializedState = JSON.stringify(stateToSave, null, 2); // Pretty print for debuggability
            await writeTextFile(this.fileName, serializedState, { baseDir: this.baseDir });
        } catch (err) {
            console.error('Failed to save state to filesystem:', err);
        }
    }

    private getDefaultState(): AppState {
        return {
            images: [], // Start fresh
            collections: INITIAL_COLLECTIONS,
            smartCollections: [],
            settings: createDefaultAppSettings(),
            recentSearches: []
        };
    }
}
