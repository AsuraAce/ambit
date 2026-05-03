import { AIImage, AppSettings, Collection, FacetType, FilterState, GeneratorTool, SmartCollection, SortOption } from '../types';
import type { AppState, IRepository } from './repository';
import type { Facets, LibraryStats, ValidFacetNames } from './db/searchRepo';
import { getDateFilterBounds, getSearchDateBounds, timestampMatchesDateBounds } from '../utils/dateFilters';

const STORAGE_KEY = 'ambit_browser_mock_state_v1';
const MOCK_COUNT = 180;

const DEFAULT_SETTINGS: AppSettings = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    autoCheckForUpdates: false,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [
        { id: 'mock-folder-1', path: 'C:/Mock/ComfyUI/output', isActive: true, imageCount: MOCK_COUNT, variant: GeneratorTool.COMFYUI },
        { id: 'mock-folder-2', path: 'D:/Mock/A1111/outputs', isActive: true, imageCount: 42, variant: GeneratorTool.AUTOMATIC1111 },
    ],
    maskedKeywords: ['nsfw', 'blood', 'gore'],
    maskingMode: 'blur',
    enableAI: false,
    syncBoardsToCollections: false,
    importOrphans: true,
    starredAs: 'favorite',
    resourceViewModes: {},
    hideImportModal: false,
    enableAutoThumbnailHealing: false,
    enforceHighQualityThumbnails: false,
    logLevel: 'info',
    devMode: true,
};

const MODELS = ['Flux.1 Dev', 'SDXL 1.0 Base', 'Pony Diffusion V6', 'Illustrious XL', 'DreamShaper 8'];
const LORAS = ['detail_tweaker_v1', 'cinematic_lighting', 'soft_portrait', 'isometric_world', 'lineart_boost'];
const EMBEDDINGS = ['easynegative', 'bad-hands-5', 'unaestheticXL'];
const CONTROL_NETS = ['control_v11p_sd15_canny', 'control_v11f1p_sd15_depth', 'control_openpose'];
const IP_ADAPTERS = ['ip-adapter-plus_sd15', 'ip-adapter-faceid_sd15'];
const SAMPLERS = ['DPM++ 2M Karras', 'Euler a', 'UniPC', 'DPM++ SDE'];
const PROMPTS = [
    'neon rain, reflective street, cinematic cyberpunk portrait',
    'quiet solarpunk garden city, glass towers, morning light',
    'fantasy character study, ornate armor, soft rim light',
    'cozy studio desk, concept art, warm practical lights',
    'surreal mountain observatory, clouds below, matte painting',
    'isometric workshop, tiny tools, clean product render',
];

const colorForIndex = (index: number): string => {
    const colors = ['#3b6f6a', '#8b5e34', '#5e6f9f', '#7b4f72', '#637047', '#9a5b54'];
    return colors[index % colors.length];
};

const makeImageDataUrl = (index: number, width: number, height: number): string => {
    const bg = colorForIndex(index);
    const accent = colorForIndex(index + 2);
    const label = `Ambit Mock ${index + 1}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#18181b"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${Math.round(width * 0.75)}" cy="${Math.round(height * 0.22)}" r="${Math.round(Math.min(width, height) * 0.18)}" fill="${accent}" opacity="0.45"/>
<rect x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.58)}" width="${Math.round(width * 0.8)}" height="${Math.round(height * 0.18)}" rx="10" fill="#ffffff" opacity="0.14"/>
<text x="50%" y="50%" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="${Math.max(20, Math.round(width / 18))}" font-weight="700" text-anchor="middle">${label}</text>
</svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const createMockImages = (): AIImage[] => {
    const now = Date.now();

    return Array.from({ length: MOCK_COUNT }, (_, index) => {
        const isPortrait = index % 3 === 0;
        const width = isPortrait ? 832 : 1216;
        const height = isPortrait ? 1216 : 832;
        const tool = index % 5 === 0
            ? GeneratorTool.AUTOMATIC1111
            : index % 4 === 0
                ? GeneratorTool.INVOKEAI
                : GeneratorTool.COMFYUI;
        const model = MODELS[index % MODELS.length];
        const prompt = PROMPTS[index % PROMPTS.length];
        const timestamp = now - (index * 6 * 60 * 60 * 1000);
        const loras = index % 2 === 0 ? [LORAS[index % LORAS.length]] : [];
        const embeddings = index % 7 === 0 ? [EMBEDDINGS[index % EMBEDDINGS.length]] : [];
        const controlNets = index % 6 === 0 ? [CONTROL_NETS[index % CONTROL_NETS.length]] : [];
        const ipAdapters = index % 9 === 0 ? [IP_ADAPTERS[index % IP_ADAPTERS.length]] : [];

        return {
            id: `mock_${index + 1}`,
            url: makeImageDataUrl(index, width, height),
            thumbnailUrl: makeImageDataUrl(index, 360, 360),
            microThumbnail: makeImageDataUrl(index, 48, 48),
            filename: `mock_generation_${String(index + 1).padStart(4, '0')}.png`,
            fileSize: 1_200_000 + index * 17_321,
            timestamp,
            width,
            height,
            isFavorite: index % 8 === 0,
            isPinned: index % 19 === 0,
            isIntermediate: index % 11 === 0,
            userMasked: index % 37 === 0,
            notes: index % 10 === 0 ? 'Browser mock note for UI review.' : undefined,
            metadata: {
                tool,
                model,
                seed: 100_000 + index * 1337,
                steps: 18 + (index % 32),
                cfg: Number((4 + (index % 8) * 0.5).toFixed(1)),
                sampler: SAMPLERS[index % SAMPLERS.length],
                positivePrompt: prompt,
                negativePrompt: 'low quality, blurry, watermark',
                workflowJson: tool === GeneratorTool.COMFYUI ? '{"mock":true,"nodes":[]}' : undefined,
                rawParameters: `${prompt}\nSteps: ${18 + (index % 32)}, Sampler: ${SAMPLERS[index % SAMPLERS.length]}`,
                loras,
                embeddings,
                controlNets,
                ipAdapters,
                generationType: index % 5 === 0 ? 'img2img' : 'txt2img',
                isGrid: index % 17 === 0,
                isIntermediate: index % 11 === 0,
                modelHash: `mockhash${index % MODELS.length}`,
            },
        };
    });
};

const createMockCollections = (images: AIImage[]): Collection[] => [
    {
        id: 'mock_showcase',
        name: 'Mock Showcase',
        description: 'Static browser mock collection',
        imageIds: images.slice(0, 18).map((image) => image.id),
        count: 18,
        thumbnail: images[0]?.thumbnailUrl,
        color: '#3b6f6a',
        createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        isPinned: true,
        source: 'ambit',
    },
    {
        id: 'mock_favorites',
        name: 'Favorite Mock Images',
        description: 'Smart browser mock collection',
        imageIds: [],
        count: images.filter((image) => image.isFavorite).length,
        thumbnail: images.find((image) => image.isFavorite)?.thumbnailUrl,
        color: '#7b4f72',
        createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 60 * 60 * 1000,
        source: 'ambit',
        filters: {
            searchQuery: '',
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            samplers: [],
            generationTypes: [],
            controlNets: [],
            ipAdapters: [],
            dateRange: 'all',
            favoritesOnly: true,
            collectionId: null,
            showIntermediates: false,
            showGrids: false,
        },
    },
];

const defaultState = (): AppState => {
    const images = createMockImages();
    return {
        images,
        collections: createMockCollections(images),
        smartCollections: [],
        settings: DEFAULT_SETTINGS,
        recentSearches: ['cinematic', 'flux', 'portrait'],
    };
};

let state: AppState = defaultState();

const loadStoredState = (): AppState => {
    if (typeof localStorage === 'undefined') return state;

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return state;
        const parsed = JSON.parse(saved) as Partial<AppState>;

        state = {
            ...state,
            ...parsed,
            images: state.images,
            settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
            collections: parsed.collections?.length ? parsed.collections : state.collections,
            smartCollections: parsed.smartCollections ?? [],
            recentSearches: parsed.recentSearches ?? state.recentSearches,
        };
    } catch (error) {
        console.error('[BrowserMock] Failed to load mock state', error);
    }

    return state;
};

const persistState = (): void => {
    if (typeof localStorage === 'undefined') return;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            collections: state.collections,
            smartCollections: state.smartCollections,
            settings: state.settings,
            recentSearches: state.recentSearches,
        }));
    } catch (error) {
        console.error('[BrowserMock] Failed to persist mock state', error);
    }
};

export class BrowserMockRepository implements IRepository {
    async load(): Promise<AppState> {
        return loadStoredState();
    }

    async save(nextState: AppState): Promise<void> {
        state = {
            ...state,
            ...nextState,
            images: state.images,
            settings: { ...DEFAULT_SETTINGS, ...nextState.settings },
        };
        persistState();
    }
}

export const getBrowserMockImages = (): AIImage[] => loadStoredState().images;

export const getBrowserMockCollections = (): Collection[] => {
    const current = loadStoredState();
    return [...current.collections, ...current.smartCollections].map((collection) => ({
        ...collection,
        count: getCollectionCount(collection),
        thumbnail: collection.customThumbnail
            ? current.images.find((image) => image.id === collection.customThumbnail)?.thumbnailUrl
            : collection.thumbnail,
    }));
};

const getCollectionCount = (collection: Collection): number => {
    if (collection.filters) {
        return filterImages(state.images, collection.filters, state.collections).length;
    }

    return collection.imageIds.length;
};

const isSmartCollection = (collection: Collection): collection is SmartCollection => !!collection.filters;

const matchesEverySelected = (values: string[] | undefined, selected: string[] | undefined): boolean => {
    if (!selected || selected.length === 0) return true;
    const lowerValues = new Set((values ?? []).map((value) => value.toLowerCase()));
    return selected.some((value) => lowerValues.has(value.toLowerCase()));
};

interface BrowserSearchToken {
    term: string;
    isNegative: boolean;
    isOrOperator: boolean;
}

const tokenizeBrowserSearchQuery = (query: string): BrowserSearchToken[] => {
    const termRegex = /(-|!)?("(?:[^"\\]|\\.)*"|\S+)/g;
    const tokens: BrowserSearchToken[] = [];
    let match: RegExpExecArray | null;

    while ((match = termRegex.exec(query)) !== null) {
        const isNegative = !!match[1];
        const rawTerm = match[2];
        const isQuoted = rawTerm.startsWith('"') && rawTerm.endsWith('"');
        const term = isQuoted
            ? rawTerm.slice(1, -1).replace(/\\"/g, '"')
            : rawTerm;

        tokens.push({
            term,
            isNegative,
            isOrOperator: !isNegative && !isQuoted && term.toLowerCase() === 'or',
        });
    }

    return tokens;
};

const isPositivePromptSearchToken = (token: BrowserSearchToken): boolean => {
    const lowerTerm = token.term.toLowerCase();
    return !token.isNegative
        && !token.isOrOperator
        && !(lowerTerm.includes(':') && !lowerTerm.startsWith(':'));
};

const includesText = (value: string | number | undefined, term: string): boolean => (
    value !== undefined && String(value).toLowerCase().includes(term)
);

const matchesNumberExpression = (value: number | undefined, expression: string): boolean => {
    if (value === undefined) return false;
    if (expression.startsWith('>')) return value > Number(expression.slice(1));
    if (expression.startsWith('<')) return value < Number(expression.slice(1));
    return value === Number(expression);
};

const matchesScopedSearchToken = (image: AIImage, token: BrowserSearchToken): boolean | null => {
    const lowerTerm = token.term.toLowerCase();
    if (!lowerTerm.includes(':') || lowerTerm.startsWith(':')) return null;

    const separatorIndex = lowerTerm.indexOf(':');
    const key = lowerTerm.slice(0, separatorIndex);
    const val = lowerTerm.slice(separatorIndex + 1);

    const haystack = [
        image.filename,
        image.notes,
        image.metadata.model,
        image.metadata.tool,
        image.metadata.positivePrompt,
        image.metadata.negativePrompt,
        ...(image.metadata.loras ?? []),
    ].filter(Boolean).join(' ').toLowerCase();

    let matched: boolean | null = null;
    const dateBounds = getSearchDateBounds(key, val);
    if (dateBounds) matched = timestampMatchesDateBounds(image.timestamp, dateBounds);
    else if (key === 'steps') matched = matchesNumberExpression(image.metadata.steps, val);
    else if (key === 'cfg') matched = matchesNumberExpression(image.metadata.cfg, val);
    else if (key === 'w' || key === 'width') matched = matchesNumberExpression(image.width, val);
    else if (key === 'h' || key === 'height') matched = matchesNumberExpression(image.height, val);
    else if (key === 'model') matched = includesText(image.metadata.model, val);
    else if (key === 'seed') matched = includesText(image.metadata.seed, val);
    else if (key === 'neg' || key === 'negative') matched = includesText(image.metadata.negativePrompt, val);
    else if (key === 'file' || key === 'filename' || key === 'path') matched = includesText(image.filename, val);
    else if (key === 'all') matched = haystack.includes(val);
    else if (key === 'sampler') matched = includesText(image.metadata.sampler, val);
    else if (key === 'tool') matched = includesText(image.metadata.tool, val);
    else if (key === 'lora') matched = (image.metadata.loras ?? []).some((name) => includesText(name, val));
    else if (key === 'cn' || key === 'controlnet') matched = (image.metadata.controlNets ?? []).some((name) => includesText(name, val));
    else if (key === 'ip' || key === 'ipadapter') matched = (image.metadata.ipAdapters ?? []).some((name) => includesText(name, val));
    else if (key === 'upscaled') matched = Boolean(image.metadata.upscaled) === (val === 'true');

    if (matched === null) return null;
    return token.isNegative ? !matched : matched;
};

const matchesSearchToken = (image: AIImage, token: BrowserSearchToken): boolean | null => {
    const scopedMatch = matchesScopedSearchToken(image, token);
    if (scopedMatch !== null) return scopedMatch;

    const prompt = image.metadata.positivePrompt.toLowerCase();
    const term = token.term.toLowerCase();
    const matched = prompt.includes(term);
    return token.isNegative ? !matched : matched;
};

const matchesSearchQuery = (image: AIImage, query: string): boolean => {
    const tokens = tokenizeBrowserSearchQuery(query);
    let index = 0;

    while (index < tokens.length) {
        const token = tokens[index];
        if (token.isOrOperator) {
            index += 1;
            continue;
        }

        if (isPositivePromptSearchToken(token)) {
            const prompt = image.metadata.positivePrompt.toLowerCase();
            const groupTerms = [token.term.toLowerCase()];
            let nextIndex = index + 1;

            while (nextIndex + 1 < tokens.length && tokens[nextIndex].isOrOperator && isPositivePromptSearchToken(tokens[nextIndex + 1])) {
                groupTerms.push(tokens[nextIndex + 1].term.toLowerCase());
                nextIndex += 2;
            }

            if (!groupTerms.some((term) => prompt.includes(term))) return false;
            index = nextIndex;
            continue;
        }

        const matched = matchesSearchToken(image, token);
        if (matched === false) return false;
        index += 1;
    }

    return true;
};

const filterImages = (images: AIImage[], filters: FilterState, collections: Collection[]): AIImage[] => {
    const text = filters.searchQuery.trim().toLowerCase();
    const dateBounds = getDateFilterBounds(filters);
    const hasGlobalDateFilter = dateBounds.start !== undefined || dateBounds.end !== undefined;
    const selectedCollection = filters.collectionId
        ? collections.find((collection) => collection.id === filters.collectionId)
        : null;
    const collectionIds = selectedCollection && !selectedCollection.filters
        ? new Set(selectedCollection.imageIds)
        : null;
    const smartFilters = selectedCollection?.filters
        ? {
            ...selectedCollection.filters,
            collectionId: null,
            ...(hasGlobalDateFilter ? { dateRange: 'all' as const, dateFrom: undefined, dateTo: undefined } : {})
        }
        : null;
    const smartMatches = smartFilters
        ? new Set(filterImages(images, smartFilters, collections).map((image) => image.id))
        : null;

    return images.filter((image) => {
        if (image.isDeleted) return false;
        if (!filters.showIntermediates && (image.isIntermediate || image.metadata.isIntermediate)) return false;
        if (!filters.showGrids && image.metadata.isGrid) return false;
        if (filters.favoritesOnly && !image.isFavorite) return false;
        if (filters.pinnedOnly && !image.isPinned) return false;
        if (!timestampMatchesDateBounds(image.timestamp, dateBounds)) return false;
        if (collectionIds && !collectionIds.has(image.id)) return false;
        if (smartMatches && !smartMatches.has(image.id)) return false;
        if (filters.models.length > 0 && !filters.models.includes(image.metadata.model)) return false;
        if (filters.tools.length > 0 && !filters.tools.includes(image.metadata.tool)) return false;
        if (!matchesEverySelected(image.metadata.loras, filters.loras)) return false;
        if (!matchesEverySelected(image.metadata.embeddings, filters.embeddings)) return false;
        if (!matchesEverySelected(image.metadata.hypernetworks, filters.hypernetworks)) return false;
        if (!matchesEverySelected(image.metadata.controlNets, filters.controlNets)) return false;
        if (!matchesEverySelected(image.metadata.ipAdapters, filters.ipAdapters)) return false;
        if (!matchesEverySelected([image.metadata.sampler], filters.samplers)) return false;
        if (!matchesEverySelected([image.metadata.generationType ?? 'unknown'], filters.generationTypes)) return false;
        if (filters.minSteps !== undefined && image.metadata.steps < filters.minSteps) return false;
        if (filters.maxSteps !== undefined && image.metadata.steps > filters.maxSteps) return false;
        if (filters.minCfg !== undefined && image.metadata.cfg < filters.minCfg) return false;
        if (filters.maxCfg !== undefined && image.metadata.cfg > filters.maxCfg) return false;

        if (text && !matchesSearchQuery(image, text)) return false;

        return true;
    });
};

const sortImages = (images: AIImage[], sortOption: SortOption): AIImage[] => {
    const sorted = [...images];
    sorted.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        switch (sortOption) {
            case 'date_asc': return a.timestamp - b.timestamp || a.id.localeCompare(b.id);
            case 'name_asc': return a.filename.localeCompare(b.filename);
            case 'name_desc': return b.filename.localeCompare(a.filename);
            case 'size_asc': return (a.fileSize ?? 0) - (b.fileSize ?? 0);
            case 'size_desc': return (b.fileSize ?? 0) - (a.fileSize ?? 0);
            case 'date_desc':
            default:
                return b.timestamp - a.timestamp || b.id.localeCompare(a.id);
        }
    });
    return sorted;
};

export const searchBrowserMockImages = (
    filters: FilterState,
    sortOption: SortOption,
    limit: number,
    cursorId?: string
): { images: AIImage[]; totalCount: number; globalCount: number } => {
    const current = loadStoredState();
    const filtered = sortImages(filterImages(current.images, filters, getBrowserMockCollections()), sortOption);
    const start = cursorId ? Math.max(0, filtered.findIndex((image) => image.id === cursorId) + 1) : 0;
    return {
        images: filtered.slice(start, start + limit),
        totalCount: filtered.length,
        globalCount: current.images.filter((image) => !image.isDeleted).length,
    };
};

const buildFacetItems = (images: AIImage[], type: FacetType) => {
    const counts = new Map<string, number>();
    const add = (value: string | undefined) => {
        if (!value) return;
        counts.set(value, (counts.get(value) ?? 0) + 1);
    };

    images.forEach((image) => {
        if (type === 'checkpoints') add(image.metadata.model);
        if (type === 'tools') add(image.metadata.tool);
        if (type === 'loras') image.metadata.loras?.forEach(add);
        if (type === 'embeddings') image.metadata.embeddings?.forEach(add);
        if (type === 'hypernetworks') image.metadata.hypernetworks?.forEach(add);
        if (type === 'controlNets') image.metadata.controlNets?.forEach(add);
        if (type === 'ipAdapters') image.metadata.ipAdapters?.forEach(add);
    });

    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count, lastUsedAt: Date.now() - count * 1000 }));
};

export const getBrowserMockFacets = (filters?: FilterState): Facets => {
    const current = loadStoredState();
    const sourceImages = filters ? filterImages(current.images, filters, getBrowserMockCollections()) : current.images;
    const tools = buildFacetItems(sourceImages, 'tools').map((item) => item.name);

    return {
        checkpoints: buildFacetItems(sourceImages, 'checkpoints'),
        loras: buildFacetItems(sourceImages, 'loras'),
        embeddings: buildFacetItems(sourceImages, 'embeddings'),
        hypernetworks: buildFacetItems(sourceImages, 'hypernetworks'),
        controlNets: buildFacetItems(sourceImages, 'controlNets'),
        ipAdapters: buildFacetItems(sourceImages, 'ipAdapters'),
        tools,
    };
};

export const getBrowserMockStats = (filters: FilterState): LibraryStats => {
    const current = loadStoredState();
    const images = filterImages(current.images, filters, getBrowserMockCollections());
    const modelCounts = new Map<string, number>();
    const keywordCounts = new Map<string, number>();

    images.forEach((image) => {
        modelCounts.set(image.metadata.model, (modelCounts.get(image.metadata.model) ?? 0) + 1);
        image.metadata.positivePrompt.toLowerCase().split(/[^a-z0-9]+/).forEach((word) => {
            if (word.length > 3) keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1);
        });
    });

    return {
        totalImages: images.length,
        totalGenerations: images.length,
        avgSteps: images.length
            ? Math.round(images.reduce((sum, image) => sum + image.metadata.steps, 0) / images.length)
            : 0,
        estSizeMB: (images.reduce((sum, image) => sum + (image.fileSize ?? 0), 0) / 1_000_000).toFixed(1),
        modelStats: Array.from(modelCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([name, count]) => ({ name: name.split(' ')[0], fullName: name, count })),
        keywordStats: Array.from(keywordCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 40)
            .map(([text, value]) => ({ text, value })),
    };
};

export const getBrowserMockValidFacetNames = (filters: FilterState): ValidFacetNames => {
    const facets = getBrowserMockFacets(filters);
    return {
        checkpoints: facets.checkpoints.map((item) => item.name),
        loras: facets.loras.map((item) => item.name),
        embeddings: facets.embeddings.map((item) => item.name),
        hypernetworks: facets.hypernetworks.map((item) => item.name),
        tools: facets.tools,
        controlNets: facets.controlNets.map((item) => item.name),
        ipAdapters: facets.ipAdapters.map((item) => item.name),
    };
};

export const upsertBrowserMockCollection = (collection: Partial<Collection> & { id: string; name: string }): void => {
    const collections = getBrowserMockCollections();
    const existingIndex = collections.findIndex((item) => item.id === collection.id);
    const next: Collection = {
        imageIds: [],
        createdAt: Date.now(),
        source: 'ambit',
        ...collections[existingIndex],
        ...collection,
        updatedAt: Date.now(),
    };

    const nextCollections = existingIndex >= 0
        ? collections.map((item) => item.id === collection.id ? next : item)
        : [...collections, next];

    state.collections = nextCollections.filter((item) => !isSmartCollection(item));
    state.smartCollections = nextCollections.filter(isSmartCollection);
    persistState();
};

export const deleteBrowserMockCollection = (id: string): void => {
    state.collections = state.collections.filter((collection) => collection.id !== id);
    state.smartCollections = state.smartCollections.filter((collection) => collection.id !== id);
    persistState();
};

export const addBrowserMockImagesToCollection = (collectionId: string, imageIds: string[]): void => {
    const collection = getBrowserMockCollections().find((item) => item.id === collectionId);
    if (!collection) return;
    upsertBrowserMockCollection({
        ...collection,
        imageIds: Array.from(new Set([...collection.imageIds, ...imageIds])),
    });
};

export const removeBrowserMockImagesFromCollection = (collectionId: string, imageIds: string[]): void => {
    const removeIds = new Set(imageIds);
    const collection = getBrowserMockCollections().find((item) => item.id === collectionId);
    if (!collection) return;
    upsertBrowserMockCollection({
        ...collection,
        imageIds: collection.imageIds.filter((id) => !removeIds.has(id)),
    });
};

export const updateBrowserMockImage = (id: string, update: Partial<AIImage>): void => {
    state.images = state.images.map((image) => image.id === id ? { ...image, ...update } : image);
};
