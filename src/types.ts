

export enum GeneratorTool {
  COMFYUI = 'ComfyUI',
  AUTOMATIC1111 = 'Automatic1111',
  MIDJOURNEY = 'Midjourney',
  INVOKEAI = 'InvokeAI',
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
  controlNets?: string[];
  ipAdapters?: string[];

  // Generation Variations
  variationId?: string; // A signature (e.g. "seed:strength") for sub-noise variations
  upscaled?: boolean;
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
}

export interface AIImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  filename: string;
  fileSize?: number; // Size in bytes, used for duplicate detection
  timestamp: number; // Unix timestamp
  width: number;
  height: number;
  isFavorite: boolean;
  isPinned?: boolean;
  isDeleted?: boolean; // Soft delete flag
  isMissing?: boolean; // File system link broken
  userMasked?: boolean; // Explicit manual mask
  groupId?: string; // ID linking multiple versions/upscales
  boardId?: string; // ID linking to external board/collection
  stack?: AIImage[]; // UI ONLY: List of images collapsed under this one
  notes?: string;
  metadata: ImageMetadata;
  originalMetadata?: ImageMetadata; // Snapshot for undo/revert
}

export interface FilterState {
  searchQuery: string;
  models: string[];
  tools: GeneratorTool[];
  loras: string[]; // New: Filter by LoRA usage
  dateRange: 'all' | 'today' | 'week' | 'month';
  favoritesOnly: boolean;
  collectionId: string | null;
  minSteps?: number;
  maxSteps?: number;
  minCfg?: number;
  maxCfg?: number;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  imageIds: string[];
  count?: number; // Optimized: Store count directly to avoid loading all IDs
  thumbnail?: string;
  customThumbnail?: string; // Explicit user choice
  color?: string; // Hex or tailwind color name for organization
  createdAt: number;
  isArchived?: boolean;
  isPinned?: boolean;
}

export interface SmartCollection {
  id: string;
  name: string;
  filters: FilterState;
  icon?: string;
}

export type SortOption = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'size_desc' | 'size_asc';

export interface MonitoredFolder {
  id: string;
  path: string;
  isActive: boolean;
  imageCount: number;
}

export interface AppSettings {
  hasCompletedOnboarding: boolean;
  theme: 'dark' | 'light';
  thumbnailSize: number;
  confirmDelete: boolean;
  defaultTheaterMode: boolean; // Persist sidebar state
  monitoredFolders: MonitoredFolder[];

  // Privacy & AI
  maskedKeywords: string[];
  maskingMode: 'blur' | 'hide';
  enableAI: boolean;
  googleGeminiApiKey?: string;
  invokeAiPath?: string; // Root path to InvokeAI (containing databases/invokeai.db)
  syncBoardsToCollections?: boolean; // New: Option to turn boards into persistent collections
  lastSyncedAt?: number | null; // Timestamp of the last successful sync
  importIntermediates?: boolean; // New: Option to ignore/hide intermediate images during sync
  importOrphans?: boolean; // New: Option to scan for files not in DB
  starredAs?: 'favorite' | 'pin' | 'both'; // New: Map starred images to favorites, pins, or both
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface ContextMenuState {
  x: number;
  y: number;
  imageId: string;
}