

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
  error?: boolean;
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
  embeddings: string[];
  hypernetworks: string[];
  dateRange: 'all' | 'today' | 'week' | 'month';
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
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  imageIds: string[];
  count?: number;
  thumbnail?: string;
  customThumbnail?: string;
  color?: string;
  createdAt: number;
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

export type FacetSortOption =
  | 'count_desc' | 'count_asc'
  | 'name_asc' | 'name_desc'
  | 'recent_desc' | 'recent_asc'
  | 'added_desc' | 'added_asc';

export interface MonitoredFolder {
  id: string;
  path: string;
  isActive: boolean;
  imageCount: number;
  variant?: GeneratorTool; // Store the detected/assigned variant
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
  a1111Path?: string; // New: Root path to Stable Diffusion WebUI (A1111)
  comfyUiPath?: string; // New: Root path to ComfyUI output (used for output discovery)
  syncBoardsToCollections?: boolean; // New: Option to turn boards into persistent collections
  lastSyncedAt?: number | null; // Timestamp of the last successful sync
  importIntermediates?: boolean; // New: Option to ignore/hide intermediate images during sync
  importOrphans?: boolean; // New: Option to scan for files not in DB
  starredAs?: 'favorite' | 'pin' | 'both' | 'none'; // New: Map starred images to favorites, pins, or both
  libraryShowGrids?: boolean; // Persisted view preference
  libraryShowIntermediates?: boolean; // Persisted view preference
  resourceFolders?: string[]; // New: Folders to scan for resources (models/loras)
  resourceViewModes?: Record<string, 'grid' | 'list'>; // Persisted view mode per resource section
  resourceSortOptions?: Record<string, FacetSortOption>; // Persisted sort option per resource section
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export interface ContextMenuState {
  x: number;
  y: number;
  imageId: string;
}