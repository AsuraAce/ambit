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
                return {
                    ...saved,
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
                        ...saved.settings
                    }
                };
            }
        } catch (err) {
            console.error('Failed to load state from filesystem:', err);
        }

        return this.getDefaultState();
    }

    async save(state: AppState): Promise<void> {
        try {
            await this.ensureDirectory();
            const serializedState = JSON.stringify(state, null, 2); // Pretty print for debuggability
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
                enableAI: false
            },
            recentSearches: []
        };
    }
}
