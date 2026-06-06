

export enum GeneratorTool {
  COMFYUI = 'ComfyUI',
  AUTOMATIC1111 = 'Automatic1111',
  MIDJOURNEY = 'Midjourney',
  INVOKEAI = 'InvokeAI',
  SDNEXT = 'SD.Next',
  FORGE = 'Forge',
  ANAPNOE = 'Anapnoe',
  UNKNOWN = 'Unknown'
}

export enum ModelType {
  SDXL = 'SDXL 1.0',
  SD15 = 'Stable Diffusion 1.5',
  FLUX = 'Flux.1',
  PONY = 'Pony Diffusion V6',
  ILLUSTRIOUS = 'Illustrious XL',
  ANIMAGINE = 'Animagine XL'
}

export type ViewMode = 'grid' | 'timeline' | 'dashboard' | 'maintenance';

export type LayoutMode = 'grid' | 'masonry' | 'justified';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

export type ImportMode = 'manual' | 'startup' | 'background';

export type RecoveryStyle = 'generic' | 'midjourney' | 'sdxl' | 'danbooru';

export interface ImageMetadata {
  tool: GeneratorTool;
  model: string;
  overrideModel?: string; // User-forced model architecture
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  positivePrompt: string;
  negativePrompt: string;
  workflowJson?: string; // For ComfyUI raw data
  rawParameters?: string; // The exact raw string extracted from the file

  // Advanced Metadata
  loras?: string[];
  embeddings?: string[];
  hypernetworks?: string[];
  controlNets?: string[];
  ipAdapters?: string[];

  // Generation Variations
  variationId?: string; // A signature (e.g. "seed:strength") for sub-noise variations
  upscaled?: boolean;
  isIntermediate?: boolean;
  isGrid?: boolean;
  hasWorkflowHint?: boolean; // New: Hint from external DB if workflow exists

  // New fields for deeper extraction
  vae?: string;
  clipSkip?: number;
  denoisingStrength?: number;
  hiresUpscale?: number;
  hiresSteps?: number;
  hiresUpscaler?: string;
  modelHash?: string;
  generationType?: 'txt2img' | 'img2img' | 'extras' | 'grid' | 'unknown';
  isFavorite?: boolean; // Extracted from legacy metadata (e.g. Subject: favorite)
}

export interface ParseResult {
  metadata: Partial<ImageMetadata>;
  extra: {
    isFavorite?: boolean;
    board?: string;
  };
  isIntermediate?: boolean;
  // Native Scan Optimization Props
  width?: number;
  height?: number;
  fileSize?: number;
  timestamp?: number;
  thumbnail?: string;
  /** Base64 data URI for instant 32px preview */
  microThumbnail?: string;
  /** Source of the thumbnail: 'ambit', 'invokeai', etc. */
  thumbnailSource?: string;
  originalChunks?: Record<string, string>; // Raw chunks for re-parsing
  error?: boolean;
  errorReason?: string;
}

export interface MissingFileAuditResult {
  scanned: number;
  total: number;
  missingIds: string[];
  sampleMissingPaths: string[];
  wasCancelled: boolean;
}

// Snapshot of image-level state at import time (for sync conflict resolution)
export interface OriginalState {
  isFavorite?: boolean;
  isPinned?: boolean;
  boardId?: string;
}

export interface AIImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  /** Base64 data URI for instant 32px preview (progressive loading) */
  microThumbnail?: string;
  /** Source of the thumbnail: 'ambit', 'invokeai', etc. */
  thumbnailSource?: string;
  filename: string;
  fileSize?: number; // Size in bytes, used for duplicate detection
  fileHash?: string; // SHA-256 content hash for exact duplicate detection
  timestamp: number; // Unix timestamp
  width: number;
  height: number;
  isFavorite: boolean;
  isPinned?: boolean;
  isDeleted?: boolean; // Soft delete flag
  isIntermediate?: boolean;
  isMissing?: boolean; // File system link broken
  isCorrupt?: boolean; // File scan failed permanently
  userMasked?: boolean; // Explicit manual mask
  groupId?: string; // ID linking multiple versions/upscales
  boardId?: string; // ID linking to external board/collection
  stack?: AIImage[]; // UI ONLY: List of images collapsed under this one
  notes?: string;
  metadata: ImageMetadata;
  originalMetadata?: ImageMetadata; // Snapshot for undo/revert
  originalChunks?: Record<string, string>; // Raw chunks for re-parsing (persisted to DB)
  originalState?: OriginalState; // Snapshot of image-level state at import (for sync)
}

export interface FilterState {
  searchQuery: string;
  models: string[];
  tools: GeneratorTool[];
  loras: string[]; // New: Filter by LoRA usage
  embeddings: string[];
  hypernetworks: string[];
  samplers: string[]; // Filter by sampler name
  generationTypes: string[]; // Filter by generation type (txt2img, img2img, etc.)
  controlNets: string[];
  ipAdapters: string[];
  dateRange: 'all' | 'today' | 'week' | 'month' | 'custom';
  dateFrom?: string;
  dateTo?: string;
  favoritesOnly: boolean;
  collectionId: string | null;
  minSteps?: number;
  maxSteps?: number;
  minCfg?: number;
  maxCfg?: number;
  pinnedOnly?: boolean;
  showIntermediates?: boolean;
  showGrids?: boolean;
  sortOption?: SortOption;
  matchModes?: Record<string, 'any' | 'all'>; // Key: filter key (e.g. 'loras'), Value: 'any' (OR) | 'all' (AND)
  assetFilterAliases?: Partial<Record<'models' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters', Record<string, string[]>>>;
}


export interface Collection {
  id: string;
  name: string;
  description?: string;
  imageIds: string[];
  count?: number;
  thumbnail?: string;
  customThumbnail?: string;
  safeThumbnail?: string;
  thumbnailIsSensitive?: boolean;
  thumbnailSourceKind?: 'dynamic' | 'customImage' | 'customPath';
  color?: string;
  createdAt: number;
  updatedAt?: number; // Added for 'Recently Updated' sort
  isArchived?: boolean;
  isPinned?: boolean;
  filters?: FilterState; // Added for Smart/Hybrid logic
  manualExclusions?: string[]; // Added for Hybrid override logic
  source?: 'ambit' | 'invoke'; // Added to track InvokeAI boards
}

export interface SmartCollection extends Collection {
  // Kept for backward compatibility, now just a specialized Collection
  filters: FilterState;
}

export type SortOption = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'size_desc' | 'size_asc';

export type MetadataRefreshScope = 'full' | 'images-only';

export type AssetScope = 'used' | 'local' | 'all';

export type FacetSortOption =
  | 'count_desc' | 'count_asc'
  | 'name_asc' | 'name_desc'
  | 'recent_desc' | 'recent_asc'
  | 'added_desc' | 'added_asc';

export type CollectionSortOption =
  | 'name_asc' | 'name_desc'
  | 'count_asc' | 'count_desc'
  | 'date_asc' | 'date_desc'
  | 'recent_desc' | 'recent_asc';

export type SidebarSortOption = FacetSortOption | CollectionSortOption;

export type FacetType = 'checkpoints' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters' | 'tools';


export interface PaginationCursor {
  val: number | string;
  id: string;
  isPinned?: number;
}

export interface MonitoredFolder {
  id: string;
  path: string;
  /** Synthetic integration folders rendered in settings but not persisted as user-added folders. */
  isManaged?: boolean;
  /** Raw integration output path for managed folders. */
  pathRaw?: string;
  isActive: boolean;
  imageCount: number;
  lastScanned?: number; // Timestamp of last successful full/partial scan
  variant?: GeneratorTool; // Store the detected/assigned variant
  initialScanPending?: boolean; // Suppress duplicate auto-scan until the first queued scan completes
  initialScanCancelled?: boolean; // User cancelled initial import; do not auto-retry until manual rescan
}

export interface InvokeDbSnapshotFile {
  path: string;
  exists: boolean;
  size: number;
  modifiedMs: number | null;
}

export interface InvokeDbSnapshotState {
  dbPath: string;
  lastSyncedAt: number | null;
  importIntermediates: boolean;
  importOrphans: boolean;
  syncBoardsToCollections: boolean;
  pathRepairVersion: number;
  files: InvokeDbSnapshotFile[];
}

export interface AppSettings {
  hasCompletedOnboarding: boolean;
  theme: 'dark' | 'light';
  thumbnailSize: number;
  autoCheckForUpdates?: boolean;
  confirmDelete: boolean;
  defaultTheaterMode: boolean; // Persist sidebar state
  monitoredFolders: MonitoredFolder[];

  // Privacy & AI
  maskedKeywords: string[];
  maskingMode: 'blur' | 'hide';
  enableAI: boolean;
  /** @deprecated Moved to OS Secure Keyring. See geminiApiKey in SettingsState. */
  googleGeminiApiKey?: string;
  aiModel?: string;
  aiThinkingMode?: AiThinkingMode;
  invokeAiPath?: string; // Root path to InvokeAI (containing databases/invokeai.db)
  a1111Path?: string; // New: Root path to Stable Diffusion WebUI (A1111)
  comfyUiPath?: string; // New: Root path to ComfyUI output (used for output discovery)
  syncBoardsToCollections?: boolean; // New: Option to turn boards into persistent collections
  invokeSyncFavorites?: boolean; // Persisted sync choice for importing favorited InvokeAI images
  invokeSyncBoards?: boolean; // Persisted sync choice for importing InvokeAI board membership
  lastSyncedAt?: number | null; // Timestamp of the last successful sync
  importIntermediates?: boolean; // New: Option to ignore/hide intermediate images during sync
  importOrphans?: boolean; // New: Option to scan for files not in DB
  invokeDbSnapshot?: InvokeDbSnapshotState; // Internal: last known InvokeAI DB/WAL/SHM file snapshot for startup no-op skips
  starredAs?: 'favorite' | 'pin' | 'both' | 'none'; // New: Map starred images to favorites, pins, or both
  libraryLayoutMode?: LayoutMode; // Persisted gallery layout preference
  libraryShowGrids?: boolean; // Persisted view preference
  libraryShowIntermediates?: boolean; // Persisted view preference
  resourceFolders?: string[]; // New: Folders to scan for resources (models/loras)
  resourceViewModes?: Record<string, 'grid' | 'list'>; // Persisted view mode per resource section
  resourceSortOptions?: Record<string, SidebarSortOption>; // Persisted sort option per sidebar resource or collection section
  hideImportModal?: boolean; // User dismissed the import education modal
  systemPrompts?: Record<string, string>; // Dev override for AI prompts
  devMode?: boolean; // Toggle for experimental/dev features
  enableAutoThumbnailHealing?: boolean; // Auto-regenerate thumbnails in background
  enforceHighQualityThumbnails?: boolean; // Upgrade existing low-res thumbnails
  thumbnailOptimizationProfile?: 'quiet' | 'balanced' | 'fast'; // Background thumbnail worker profile
  logLevel?: LogLevel; // Console log severity level
}

export type AiThinkingMode = 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'off' | 'dynamic';

export type AppSettingsUpdate = Partial<AppSettings> | ((prev: AppSettings) => Partial<AppSettings>);

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ContextMenuState {
  x: number;
  y: number;
  imageId: string;
}
