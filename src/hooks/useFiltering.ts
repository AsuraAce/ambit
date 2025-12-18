

import { useState, useMemo } from 'react';
import { AIImage, FilterState, Collection, SortOption, AppSettings } from '../types';

export const useFiltering = (
    images: AIImage[],
    collections: Collection[],
    privacyEnabled: boolean,
    maskingMode: AppSettings['maskingMode'],
    maskedKeywords: string[]
) => {
    const [filters, setFilters] = useState<FilterState>({
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        dateRange: 'all',
        favoritesOnly: false,
        collectionId: null,
    });

    const [sortOption, setSortOption] = useState<SortOption>('date_desc');

    // Parse Advanced Search Syntax (e.g. "steps:>20 model:flux")
    const parseAdvancedSearch = (query: string, img: AIImage): boolean => {
        if (!query) return true;
        const terms = query.split(' ');

        return terms.every(term => {
            const lowerTerm = term.toLowerCase();
            if (lowerTerm.includes(':')) {
                const [key, val] = lowerTerm.split(':');
                switch (key) {
                    case 'steps':
                        if (val.startsWith('>')) return img.metadata.steps > Number(val.slice(1));
                        if (val.startsWith('<')) return img.metadata.steps < Number(val.slice(1));
                        return img.metadata.steps === Number(val);
                    case 'cfg':
                        if (val.startsWith('>')) return img.metadata.cfg > Number(val.slice(1));
                        if (val.startsWith('<')) return img.metadata.cfg < Number(val.slice(1));
                        return img.metadata.cfg === Number(val);
                    case 'model':
                        return (img.metadata.overrideModel || img.metadata.model).toLowerCase().includes(val);
                    case 'tool':
                        return img.metadata.tool.toLowerCase().includes(val);
                    case 'lora':
                        // Check if any lora in the list includes the search value
                        return img.metadata.loras?.some(l => l.toLowerCase().includes(val)) ?? false;
                    case 'seed':
                        return String(img.metadata.seed).includes(val);
                    default:
                        return true;
                }
            }
            return (
                img.metadata.positivePrompt.toLowerCase().includes(lowerTerm) ||
                img.filename.toLowerCase().includes(lowerTerm)
            );
        });
    };

    const filteredImages = useMemo(() => {
        // 1. FILTERING
        let result = images.filter(img => {
            // 1. TRASH LOGIC: In main views, show only NOT deleted.
            if (img.isDeleted) return false;

            // 2. PRIVACY LOGIC:
            // If privacy is enabled AND mode is 'hide', we completely filter out masked items.
            if (privacyEnabled && maskingMode === 'hide') {
                const isAutoMasked = maskedKeywords.length > 0 && maskedKeywords.some(kw => img.metadata.positivePrompt.toLowerCase().includes(kw.toLowerCase()));
                if (img.userMasked || isAutoMasked) {
                    return false;
                }
            }

            if (!parseAdvancedSearch(filters.searchQuery, img)) return false;
            if (filters.collectionId) {
                const collection = collections.find(c => c.id === filters.collectionId);
                if (!collection || !collection.imageIds.includes(img.id)) return false;
            }
            if (filters.tools.length > 0 && !filters.tools.includes(img.metadata.tool)) return false;

            const effectiveModel = img.metadata.overrideModel || img.metadata.model;
            if (filters.models.length > 0 && !filters.models.includes(effectiveModel)) return false;

            // LoRA Filter (OR Logic for sidebar selection)
            // Updated: Clean name matching
            if (filters.loras.length > 0) {
                const imgLoras = img.metadata.loras || [];
                const hasSelectedLora = filters.loras.some(filterLora =>
                    imgLoras.some(rawLora => {
                        let clean = rawLora.replace(/\.(safetensors|pt|ckpt)$/i, '');
                        clean = clean.replace(/\s+\(-?\d+(\.\d+)?\)$/, '').trim();
                        return clean === filterLora;
                    })
                );
                if (!hasSelectedLora) return false;
            }

            if (filters.favoritesOnly && !img.isFavorite) return false;
            if (filters.minSteps !== undefined && img.metadata.steps < filters.minSteps) return false;
            if (filters.maxSteps !== undefined && img.metadata.steps > filters.maxSteps) return false;
            if (filters.minCfg !== undefined && img.metadata.cfg < filters.minCfg) return false;
            if (filters.maxCfg !== undefined && img.metadata.cfg > filters.maxCfg) return false;
            if (filters.dateRange !== 'all') {
                const now = Date.now();
                const diff = now - img.timestamp;
                const day = 24 * 60 * 60 * 1000;
                if (filters.dateRange === 'today' && diff > day) return false;
                if (filters.dateRange === 'week' && diff > 7 * day) return false;
                if (filters.dateRange === 'month' && diff > 30 * day) return false;
            }
            return true;
        });

        // 2. STACK COLLAPSING
        // Group images by groupId if present
        const collapsedResult: AIImage[] = [];
        const groupMap = new Map<string, AIImage[]>();

        // First pass: collect groups and standalone images
        result.forEach(img => {
            // SAFEGUARD: Only collapse if groupId looks like a valid stack ID (generated by Ambit)
            // This prevents the "Board Name" pollution from stacking entire boards.
            if (img.groupId && img.groupId.startsWith('stack_')) {
                if (!groupMap.has(img.groupId)) {
                    groupMap.set(img.groupId, []);
                }
                groupMap.get(img.groupId)!.push(img);
            } else {
                collapsedResult.push(img);
            }
        });

        // Second pass: process groups to find the "representative"
        groupMap.forEach((groupImages, groupId) => {
            if (groupImages.length === 0) return;

            // Sort group by resolution (preference for high res) and then time (newest)
            // This effectively picks the "Final Upscale" as the representative
            groupImages.sort((a, b) => {
                const resA = a.width * a.height;
                const resB = b.width * b.height;
                if (resA !== resB) return resB - resA; // Highest res first
                return b.timestamp - a.timestamp; // Newest first
            });

            // The top one is the representative
            const representative = { ...groupImages[0] };

            // Attach the rest as the 'stack' property
            representative.stack = groupImages;

            collapsedResult.push(representative);
        });

        // 3. SORTING
        return collapsedResult.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;

            switch (sortOption) {
                case 'date_asc': return a.timestamp - b.timestamp;
                case 'name_asc': return a.filename.localeCompare(b.filename);
                case 'name_desc': return b.filename.localeCompare(a.filename);
                case 'date_desc':
                default: return b.timestamp - a.timestamp;
            }
        });
    }, [images, filters, collections, sortOption, privacyEnabled, maskingMode, maskedKeywords]);

    const availableTags = useMemo(() => {
        const tags = new Set<string>();
        ['cyberpunk', 'portrait', 'landscape', 'anime', 'realistic', '8k', 'masterpiece', 'oil painting', 'concept art', 'sci-fi', 'fantasy'].forEach(t => tags.add(t));

        images.slice(0, 200).forEach(img => {
            if (img.metadata.positivePrompt) {
                img.metadata.positivePrompt.split(',').forEach(t => {
                    const clean = t.trim().toLowerCase();
                    if (clean.length > 2 && clean.length < 40) tags.add(clean);
                });
            }
        });
        return Array.from(tags).sort();
    }, [images]);

    const clearAllFilters = () => {
        setFilters(prev => ({
            ...prev,
            searchQuery: '',
            dateRange: 'all',
            favoritesOnly: false,
            models: [],
            tools: [],
            loras: [], // Clear LoRAs
            minSteps: undefined,
            maxSteps: undefined,
            minCfg: undefined,
            maxCfg: undefined
        }));
    };

    return {
        filters,
        setFilters,
        sortOption,
        setSortOption,
        filteredImages,
        availableTags,
        clearAllFilters
    };
};