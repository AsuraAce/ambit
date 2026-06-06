import type { AppSettings } from '../types';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  hasCompletedOnboarding: false,
  theme: 'dark',
  thumbnailSize: 200,
  autoCheckForUpdates: true,
  confirmDelete: true,
  defaultTheaterMode: false,
  monitoredFolders: [],
  maskedKeywords: ['nsfw', 'blood', 'gore'],
  maskingMode: 'blur',
  enableAI: false,
  aiThinkingMode: 'default',
  syncBoardsToCollections: false,
  invokeSyncFavorites: true,
  invokeSyncBoards: true,
  importOrphans: false,
  starredAs: 'favorite',
  libraryLayoutMode: 'masonry',
  resourceViewModes: {},
  hideImportModal: false,
  enableAutoThumbnailHealing: true,
  enforceHighQualityThumbnails: false,
  thumbnailOptimizationProfile: 'balanced',
  logLevel: 'info',
};

export const createDefaultAppSettings = (
  overrides: Partial<AppSettings> = {}
): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  monitoredFolders: [...DEFAULT_APP_SETTINGS.monitoredFolders],
  maskedKeywords: [...DEFAULT_APP_SETTINGS.maskedKeywords],
  resourceFolders: DEFAULT_APP_SETTINGS.resourceFolders
    ? [...DEFAULT_APP_SETTINGS.resourceFolders]
    : undefined,
  resourceViewModes: { ...DEFAULT_APP_SETTINGS.resourceViewModes },
  resourceSortOptions: DEFAULT_APP_SETTINGS.resourceSortOptions
    ? { ...DEFAULT_APP_SETTINGS.resourceSortOptions }
    : undefined,
  systemPrompts: DEFAULT_APP_SETTINGS.systemPrompts
    ? { ...DEFAULT_APP_SETTINGS.systemPrompts }
    : undefined,
  ...overrides,
});
