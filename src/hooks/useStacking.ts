import { useState, useEffect, useRef } from 'react';
import { AIImage } from '../types';
import MetadataWorker from '../workers/metadata.worker.ts?worker';

export interface StackGroup {
    id: string;
    baseImage: AIImage;
    relatedImages: AIImage[];
    reason: string;
    confidence: number;
}

// Global worker instance to prevent respawning
let sharedWorker: Worker | null = null;
const getWorker = () => {
    if (!sharedWorker) {
        sharedWorker = new MetadataWorker();
    }
    return sharedWorker;
};

export const useStacking = (images: AIImage[]) => {
    const [suggestedStacks, setSuggestedStacks] = useState<StackGroup[]>([]);
    const [isCalculating, setIsCalculating] = useState(false);

    // Debounce ref
    const timeoutRef = useRef<NodeJS.Timeout>();
    const lastImagesRef = useRef<number>(0);

    useEffect(() => {
        if (images.length === 0) {
            setSuggestedStacks([]);
            setIsCalculating(false);
            return;
        }

        // Avoid re-running if images haven't changed meaningfully (length check is a cheap proxy)
        const currentSig = images.length + (images[0]?.timestamp || 0);
        if (currentSig === lastImagesRef.current) return;
        lastImagesRef.current = currentSig;

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        setIsCalculating(true);
        timeoutRef.current = setTimeout(() => {
            const worker = getWorker();
            const requestId = `stack_${Date.now()}`;

            const handler = (e: MessageEvent) => {
                if (e.data.requestId === requestId) {
                    if (e.data.type === 'stacks-result') {
                        setSuggestedStacks(e.data.groups);
                    }
                    setIsCalculating(false);
                    worker.removeEventListener('message', handler);
                }
            };

            worker.addEventListener('message', handler);

            // Send lightweight payload
            const payload = images.map(img => ({
                id: img.id,
                timestamp: img.timestamp,
                width: img.width,
                height: img.height,
                groupId: img.groupId,
                metadata: {
                    positivePrompt: img.metadata.positivePrompt,
                    seed: img.metadata.seed,
                    model: typeof img.metadata.model === 'string' ? img.metadata.model : ((img.metadata.model as any)?.name || ''),
                    steps: img.metadata.steps,
                    cfg: img.metadata.cfg,
                    variationId: img.metadata.variationId,
                    controlNets: img.metadata.controlNets,
                    ipAdapters: img.metadata.ipAdapters
                }
            }));

            worker.postMessage({ type: 'analyze-stacks', images: payload, requestId });
        }, 500); // 500ms debounce

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [images]);

    return { suggestedStacks, isCalculating };
};
