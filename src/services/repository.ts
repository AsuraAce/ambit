
import { AIImage, Collection, SmartCollection, AppSettings } from '../types';
import { generateMockImages, INITIAL_COLLECTIONS } from '../constants';

// Define the shape of our entire persisted application state
export interface AppState {
  images: AIImage[];
  collections: Collection[];
  smartCollections: SmartCollection[];
  settings: AppSettings;
  recentSearches: string[];
}

// The Repository Interface: The contract that any storage engine must fulfill
export interface IRepository {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
}

// Implementation for Web: Uses LocalStorage
export class LocalStorageRepository implements IRepository {
  private storageKey = 'aigallery_state_v1';

  async load(): Promise<AppState> {
    return new Promise((resolve) => {
      try {
        const serializedState = localStorage.getItem(this.storageKey);
        if (serializedState) {
          const saved = JSON.parse(serializedState);
          // Migration/Merge logic to ensure settings shape is always valid
          resolve({
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
              ...saved.settings
            }
          });
          return;
        }
      } catch (err) {
        console.error('Failed to load state', err);
      }

      // Return default state if no save found
      resolve(this.getDefaultState());
    });
  }

  async save(state: AppState): Promise<void> {
    return new Promise((resolve) => {
      try {
        const serializedState = JSON.stringify(state);
        localStorage.setItem(this.storageKey, serializedState);
      } catch (err) {
        console.error('Failed to save state', err);
      }
      resolve();
    });
  }

  private getDefaultState(): AppState {
    return {
      images: generateMockImages(150),
      collections: INITIAL_COLLECTIONS,
      smartCollections: [],
      settings: {
        hasCompletedOnboarding: false,
        theme: 'dark',
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [
          { id: 'f1', path: 'C:/Users/Creator/ComfyUI/output', isActive: true, imageCount: 1450 },
          { id: 'f2', path: 'D:/SD_Outputs/Best', isActive: true, imageCount: 54 }
        ],
        maskedKeywords: ['nsfw', 'blood', 'gore'],
        maskingMode: 'blur',
        enableAI: false
      },
      recentSearches: []
    };
  }
}

import { TauriFsRepository } from './TauriFsRepository';

// Singleton instance for the app
// Switching to File System Repository for Tauri
export const appRepository = new TauriFsRepository();
