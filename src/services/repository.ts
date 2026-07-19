
import { AIImage, Collection, SmartCollection, AppSettings } from '../types';
import { generateMockImages, INITIAL_COLLECTIONS } from '../constants';
import { BrowserMockRepository } from './browserMockData';
import { isTauriRuntime } from './runtime';
import { createDefaultAppSettings, inferPromptMaskingEnabled } from '../constants/defaultSettings';

// Define the shape of our entire persisted application state
export interface AppState {
  images: AIImage[];
  collections: Collection[];
  smartCollections: SmartCollection[];
  settings: AppSettings;
  recentSearches: string[];
}

export interface PurgeScheduleResult {
  transactionId: string;
  state: AppState;
  message: string;
}

// The Repository Interface: The contract that any storage engine must fulfill
export interface IRepository {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
  update(updater: (state: AppState) => AppState): Promise<AppState>;
  schedulePurge(updater: (state: AppState) => AppState): Promise<PurgeScheduleResult>;
}

// Implementation for Web: Uses LocalStorage
export class LocalStorageRepository implements IRepository {
  private storageKey = 'aigallery_state_v1';
  private operationQueue: Promise<void> = Promise.resolve();

  async load(): Promise<AppState> {
    return this.enqueue(() => {
      return this.loadUnlocked();
    });
  }

  async save(state: AppState): Promise<void> {
    await this.enqueue(() => {
      this.saveUnlocked(state);
    });
  }

  async update(updater: (state: AppState) => AppState): Promise<AppState> {
    return this.enqueue(() => {
      const nextState = updater(this.loadUnlocked());
      this.saveUnlocked(nextState);
      return nextState;
    });
  }

  async schedulePurge(updater: (state: AppState) => AppState): Promise<PurgeScheduleResult> {
    const transactionId = crypto.randomUUID();
    const state = await this.update(updater);
    return {
      transactionId,
      state,
      message: 'Browser storage reset completed.'
    };
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private loadUnlocked(): AppState {
    try {
      const serializedState = localStorage.getItem(this.storageKey);
      if (serializedState) {
        const saved = JSON.parse(serializedState);
        const savedSettings: Partial<AppSettings> = saved.settings ?? {};
        return {
          ...saved,
          settings: createDefaultAppSettings({
            hasCompletedOnboarding: true,
            maskedKeywords: [],
            libraryShowGrids: false,
            resourceFolders: [],
            ...savedSettings,
            promptMaskingEnabled: inferPromptMaskingEnabled(savedSettings)
          })
        };
      }
    } catch (err) {
      console.error('Failed to load state', err);
    }

    return this.getDefaultState();
  }

  private saveUnlocked(state: AppState): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (err) {
      console.error('Failed to save state', err);
      throw err;
    }
  }

  private getDefaultState(): AppState {
    return {
      images: generateMockImages(150),
      collections: INITIAL_COLLECTIONS,
      smartCollections: [],
      settings: createDefaultAppSettings({
        monitoredFolders: [
          { id: 'f1', path: 'C:/Users/AmbitTester/ComfyUI/output', isActive: true, imageCount: 1450 },
          { id: 'f2', path: 'D:/SD_Outputs/Best', isActive: true, imageCount: 54 }
        ],
        maskedKeywords: ['nsfw', 'blood', 'gore'],
      }),
      recentSearches: []
    };
  }
}

import { TauriFsRepository } from './TauriFsRepository';

// Singleton instance for the app
// Use real filesystem persistence inside Tauri, and deterministic browser mocks in plain Vite.
export const appRepository = isTauriRuntime()
  ? new TauriFsRepository()
  : new BrowserMockRepository();
