
import { useState, useMemo } from 'react';
import { AIImage } from '../types';

export interface DuplicateGroup {
    id: string;
    type: 'exact' | 'version';
    images: AIImage[];
}

export const useDuplicateFinder = (images: AIImage[], onResolve: (keepId: string, deleteIds: string[]) => void, onStack?: (ids: string[]) => void) => {
  const [resolvedSignatures, setResolvedSignatures] = useState<Set<string>>(new Set());

  const { exactGroups, versionGroups } = useMemo(() => {
    // 1. Group by Broad Signature (Seed + Model + Prompt)
    const broadGroups: Record<string, AIImage[]> = {};

    images.forEach(img => {
      if (img.groupId || img.isDeleted) return;

      // EXCLUSION: Skip untagged images to avoid false positive stacking of empty prompts.
      // This prevents "Empty Prompt" matches (where Similarity = 1.0) from grouping unrelated untagged images.
      if (!img.metadata.positivePrompt || img.metadata.positivePrompt.trim() === '') return;

      const p = img.metadata.positivePrompt;
      let broadSig = `${img.metadata.seed}-${img.metadata.model}-${p.length}-${p.substring(0, 20)}`;
      
      // Incorporate ControlNet and IPAdapter fingerprints
      if (img.metadata.controlNets && img.metadata.controlNets.length > 0) {
          // Sort to ensure array order doesn't affect signature
          broadSig += `|CN:${[...img.metadata.controlNets].sort().join('+')}`;
      }
      if (img.metadata.ipAdapters && img.metadata.ipAdapters.length > 0) {
          broadSig += `|IP:${[...img.metadata.ipAdapters].sort().join('+')}`;
      }
      
      if (!broadGroups[broadSig]) broadGroups[broadSig] = [];
      broadGroups[broadSig].push(img);
    });

    const exact: DuplicateGroup[] = [];
    const versions: DuplicateGroup[] = [];

    // 2. Process each Broad Group
    Object.entries(broadGroups).forEach(([sig, groupImages]) => {
        if (groupImages.length < 2) return;

        // --- STEP 1: GLOBAL EXACT DUPLICATE DETECTION ---
        // We check for exact binary copies (Resolution + FileSize) across the ENTIRE group,
        // ignoring timestamps. This catches re-imports done days later.
        
        const exactBuckets: Record<string, AIImage[]> = {};
        const uniqueRepresentatives: AIImage[] = []; // Used for the next step (Versions)

        groupImages.forEach(img => {
            // Strict Key: Width x Height - FileSize
            // If file size is missing, we use '0', effectively grouping all missing-size images of same res together
            const size = img.fileSize || 0;
            const exactKey = `${img.width}x${img.height}-${size}`;
            
            if (!exactBuckets[exactKey]) exactBuckets[exactKey] = [];
            exactBuckets[exactKey].push(img);
        });

        // Process Exact Buckets
        Object.values(exactBuckets).forEach(bucket => {
            if (bucket.length > 1) {
                exact.push({
                    id: `exact_${bucket[0].id}`,
                    type: 'exact',
                    images: bucket
                });
            }
            // Keep one representative for the Version check
            // We use the oldest one (first in list usually, or sort)
            bucket.sort((a, b) => a.timestamp - b.timestamp);
            uniqueRepresentatives.push(bucket[0]);
        });

        // --- STEP 2: TIME-CLUSTERED VERSION DETECTION ---
        // Now we look for Workflow Stacks (Base -> Upscale) among the unique images.
        // We apply Time Clustering here because workflows happen in "bursts".
        
        if (uniqueRepresentatives.length < 2) return;

        // Sort by time for burst detection
        uniqueRepresentatives.sort((a, b) => a.timestamp - b.timestamp);
        
        const bursts: AIImage[][] = [];
        let currentBurst: AIImage[] = [uniqueRepresentatives[0]];
        
        for (let i = 1; i < uniqueRepresentatives.length; i++) {
            const prev = uniqueRepresentatives[i-1];
            const curr = uniqueRepresentatives[i];
            const timeDiff = curr.timestamp - prev.timestamp;
            
            // 2 minutes threshold for workflow bursts
            if (timeDiff > 2 * 60 * 1000) {
                bursts.push(currentBurst);
                currentBurst = [];
            }
            currentBurst.push(curr);
        }
        bursts.push(currentBurst);

        // Analyze Each Burst for Resolution Hierarchies
        bursts.forEach(burstImages => {
            if (burstImages.length < 2) return;

            // In this phase, we are looking for distinct resolutions sharing the same metadata
            // Since we already filtered exact dupes, any collision in resolution here is ambiguous
            // (e.g. two 512x512 images with different file sizes = variations).
            
            // We only want to group if there is a clean resolution hierarchy.
            const resBuckets: Record<string, AIImage[]> = {};
            let isCleanHierarchy = true;

            burstImages.forEach(img => {
                const resKey = `${img.width}x${img.height}`;
                if (!resBuckets[resKey]) resBuckets[resKey] = [];
                resBuckets[resKey].push(img);
            });

            const candidates: AIImage[] = [];

            Object.values(resBuckets).forEach(bucket => {
                // If a burst contains multiple *distinct* images at the same resolution,
                // it's likely a "Batch" generation (e.g. Generate Forever).
                // We should NOT stack Batch Item A and Batch Item B into the same "Upscale" group.
                if (bucket.length > 1) {
                    isCleanHierarchy = false;
                } else {
                    candidates.push(bucket[0]);
                }
            });

            if (isCleanHierarchy && candidates.length > 1) {
                candidates.sort((a, b) => (a.width * a.height) - (b.width * b.height));
                
                // Double check we have actual upscales/downscales
                const uniqueRes = new Set(candidates.map(c => c.width * c.height));
                
                if (uniqueRes.size > 1) {
                    versions.push({
                        id: `ver_${candidates[0].id}`,
                        type: 'version',
                        images: candidates
                    });
                }
            }
        });
    });

    return { exactGroups: exact, versionGroups: versions };
  }, [images]);

  const activeExactGroups = useMemo(() => exactGroups.filter(g => !resolvedSignatures.has(g.id)), [exactGroups, resolvedSignatures]);
  const activeVersionGroups = useMemo(() => versionGroups.filter(g => !resolvedSignatures.has(g.id)), [versionGroups, resolvedSignatures]);

  const handleResolve = (groupId: string, keepId: string, allIds: string[]) => {
    const deleteIds = allIds.filter(id => id !== keepId);
    onResolve(keepId, deleteIds);
    setResolvedSignatures(prev => new Set(prev).add(groupId));
  };

  const handleStack = (groupId: string, ids: string[]) => {
      if (onStack) {
          onStack(ids);
          setResolvedSignatures(prev => new Set(prev).add(groupId));
      }
  };

  return {
    exactGroups: activeExactGroups,
    versionGroups: activeVersionGroups,
    handleResolve,
    handleStack
  };
};
