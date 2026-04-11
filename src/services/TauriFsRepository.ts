import { BaseDirectory, readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { AppState, IRepository } from './repository';
import { generateMockImages, INITIAL_COLLECTIONS } from '../constants';

export class TauriFsRepository implements IRepository {
    private fileName = 'library.json';

    // Use AppLocalData to store in Local AppData (Windows) or appropriate local path
    private baseDir = BaseDirectory.AppLocalData;

    private async ensureDirectory() {
        // Ensure the directory exists (create if not)
        // In Tauri v2, the plugin normally handles permissions, but we might need to ensure the folder structure
        // appDataDir() returns the path. 
        // Simply try writing usually works if the app folder exists, but explicit mkdir is safer.
        // However, with BaseDirectory usage, check if we need to mkDir base.
        // Usually Tauri handles the app directory creation on setup, but let's be safe.
        // Actually, 'mkdir' with recursive: true on the base dir is good practice.
        try {
            const hasDir = await exists('', { baseDir: this.baseDir });
            if (!hasDir) {
                await mkdir('', { baseDir: this.baseDir, recursive: true });
            }
        } catch (e) {
            console.error('Error ensuring directory:', e);
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
                    this.save({ ...saved, images: [] }).catch(e => console.error('Failed to cleanup library.json', e));
                }

                return {
                    ...saved,
                    images: [], // Always return empty images from JSON, we rely on SQLite
                    settings: {
                        theme: 'dark',
                        thumbnailSize: 200,
                        confirmDelete: true,
                        defaultTheaterMode: false,
                        monitoredFolders: [],
                        maskedKeywords: [],
                        enableAI: false,
                        hasCompletedOnboarding: true,
                        libraryShowGrids: false,
                        resourceFolders: [],
                        resourceViewModes: {},
                        hideImportModal: false,
                        ...saved.settings
                    }
                };
            }
        } catch (err) {
            console.error('Failed to load state from filesystem:', err);
        }

        return this.getDefaultState();
    }

    /**
     * NOTE on Security: library.json currently stores AppSettings, which includes the googleGeminiApiKey.
     * While this is stored in the local AppLocalData folder, it is currently in plaintext.
     * TODO: In a future security-focused update, we should migrate API key storage to tauri-plugin-stronghold
     * or use the system's native keychain (via tauri-plugin-store with encryption) to ensure secrets
     * are not easily accessible if the library file is shared or the user's local disk is compromised.
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
            settings: {
                hasCompletedOnboarding: false,
                theme: 'dark',
                thumbnailSize: 200,
                confirmDelete: true,
                defaultTheaterMode: false,
                monitoredFolders: [], // Start fresh
                maskedKeywords: ['nsfw', 'blood', 'gore'],
                maskingMode: 'blur',
                enableAI: false,
                hideImportModal: false
            },
            recentSearches: []
        };
    }
}
