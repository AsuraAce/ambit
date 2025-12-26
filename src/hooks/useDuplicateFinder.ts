
import { useState, useMemo, useCallback } from 'react';
import { AIImage } from '../types';

export interface DuplicateGroup {
    id: string;
    images: AIImage[];
    newestId: string;
}

/**
 * Helper to create a stable, comparable fingerprint of the image.
 * Strips UI/Transient fields and sorts keys to ensure strict equality.
 */
const getImageFingerprint = (img: AIImage): string => {
    // If no metadata at all, these are orphans/masks and should NEVER be auto-grouped 
    // without a binary hash (which we don't have yet). Treat as unique.
    if (!img.metadata) return `unique-${img.id}`;

    // Create a clean copy with only essential generation parameters
    const {
        tool, model, seed, steps, cfg, sampler,
        positivePrompt, negativePrompt,
        loras, controlNets, ipAdapters,
        variationId
    } = img.metadata;

    // PROTECTION: Minimum Requirement Check. 
    // Handle cases where prompt might not be a string (e.g. legacy data or corrupted JSON)
    const pStr = typeof positivePrompt === 'string' ? positivePrompt : '';
    const nStr = typeof negativePrompt === 'string' ? negativePrompt : '';

    const hasPrompt = pStr.trim().length > 0;
    const hasSeed = seed !== undefined && seed !== 0 && seed !== -1;

    if (!hasPrompt && !hasSeed) {
        return `unverifiable-${img.id}`;
    }

    const core = {
        tool, model, seed, steps, cfg, sampler,
        prompt: pStr.trim(),
        neg: nStr.trim(),
        hor: img.width || 0,
        ver: img.height || 0,
        size: img.fileSize || 0,
        loras: loras ? [...loras].sort() : [],
        cn: controlNets ? [...controlNets].sort() : [],
        ip: ipAdapters ? [...ipAdapters].sort() : [],
        var: variationId
    };

    return JSON.stringify(core);
};

export const useDuplicateFinder = (images: AIImage[], onResolve: (keepId: string, deleteIds: string[]) => void) => {
    const [resolvedSignatures, setResolvedSignatures] = useState<Set<string>>(new Set());

    const groups = useMemo(() => {
        // 1. First Pass: Group by FileSize (Very fast O(N) pruning)
        const sizeBuckets: Record<number, AIImage[]> = {};
        images.forEach(img => {
            if (img.groupId || img.isDeleted) return;
            const size = img.fileSize || 0;
            if (!sizeBuckets[size]) sizeBuckets[size] = [];
            sizeBuckets[size].push(img);
        });

        const results: DuplicateGroup[] = [];

        // 2. Second Pass: Strict Metadata Comparison within Size Buckets
        Object.values(sizeBuckets).forEach(bucket => {
            if (bucket.length < 2) return;

            const metaBuckets: Record<string, AIImage[]> = {};
            bucket.forEach(img => {
                const fingerprint = getImageFingerprint(img);
                if (!metaBuckets[fingerprint]) metaBuckets[fingerprint] = [];
                metaBuckets[fingerprint].push(img);
            });

            Object.entries(metaBuckets).forEach(([fp, matches]) => {
                if (matches.length > 1) {
                    // Pre-find newestId to save render time
                    const newest = [...matches].sort((a, b) => b.timestamp - a.timestamp)[0];
                    results.push({
                        id: `dupe_${matches[0].id}`,
                        images: matches,
                        newestId: newest?.id || ''
                    });
                }
            });
        });

        return results;
    }, [images]);

    const { activeGroups, totalRedundantCount } = useMemo(() => {
        const filtered = groups.filter(g => !resolvedSignatures.has(g.id));
        const redundant = filtered.reduce((acc, g) => acc + (g.images.length - 1), 0);
        return { activeGroups: filtered, totalRedundantCount: redundant };
    }, [groups, resolvedSignatures]);

    const handleResolve = useCallback((groupId: string, keepId: string, allIds: string[]) => {
        const deleteIds = allIds.filter(id => id !== keepId);
        onResolve(keepId, deleteIds);
        setResolvedSignatures(prev => new Set(prev).add(groupId));
    }, [onResolve]);

    const handleBulkResolve = useCallback((strategy: 'newest' | 'oldest') => {
        const totalDeleteIds: string[] = [];
        const resolvedIds: string[] = [];

        groups.forEach(group => {
            if (resolvedSignatures.has(group.id)) return;

            // Sort images in group by timestamp
            const sorted = [...group.images].sort((a, b) => a.timestamp - b.timestamp);
            const keepItem = strategy === 'newest' ? sorted[sorted.length - 1] : sorted[0];

            const deleteIds = group.images
                .map(i => i.id)
                .filter(id => id !== keepItem.id);

            totalDeleteIds.push(...deleteIds);
            resolvedIds.push(group.id);
        });

        if (totalDeleteIds.length > 0) {
            // Pick a dummy keepId for the onResolve call (it's mainly used for toast/logging in parent)
            onResolve('bulk', totalDeleteIds);
            setResolvedSignatures(prev => {
                const next = new Set(prev);
                resolvedIds.forEach(id => next.add(id));
                return next;
            });
        }
    }, [groups, resolvedSignatures, onResolve]);

    return {
        groups: activeGroups,
        totalRedundantCount,
        handleResolve,
        handleBulkResolve
    };
};

