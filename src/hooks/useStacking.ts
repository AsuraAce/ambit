import { useState, useEffect, useRef } from 'react';
import { AIImage } from '../types';
import MetadataWorker from '../workers/metadata.worker.ts?worker';
import { startBackgroundDiagnostic } from '../utils/backgroundDiagnostics';
import { readModelName } from '../utils/formatUtils';

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

const getImagesSignature = (images: AIImage[]) => images.length + images[0].timestamp;

export const useStacking = (images: AIImage[]) => {
    const [suggestedStacks, setSuggestedStacks] = useState<StackGroup[]>([]);
    const [isCalculating, setIsCalculating] = useState(images.length > 0);

    // Mirrors the effect's decision below, during render: an empty library clears the stacks, and a new
    // signature (length plus first timestamp, a cheap proxy for "changed meaningfully") starts calculating.
    const [handledImages, setHandledImages] = useState(images);
    const [handledSignature, setHandledSignature] = useState(() => (images.length > 0 ? getImagesSignature(images) : 0));
    if (handledImages !== images) {
        setHandledImages(images);
        if (images.length === 0) {
            setSuggestedStacks((current) => (current.length === 0 ? current : []));
            setIsCalculating(false);
        } else if (getImagesSignature(images) !== handledSignature) {
            setHandledSignature(getImagesSignature(images));
            setIsCalculating(true);
        }
    }

    // Debounce ref
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const activeWorkerCleanupRef = useRef<(() => void) | null>(null);
    const lastImagesRef = useRef<number>(0);

    useEffect(() => {
        if (images.length === 0) {
            activeWorkerCleanupRef.current?.();
            activeWorkerCleanupRef.current = null;
            return;
        }

        // Avoid re-running if images haven't changed meaningfully
        const currentSig = getImagesSignature(images);
        if (currentSig === lastImagesRef.current) return;
        lastImagesRef.current = currentSig;

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        activeWorkerCleanupRef.current?.();
        activeWorkerCleanupRef.current = null;

        timeoutRef.current = setTimeout(() => {
            const worker = getWorker();
            const requestId = `stack_${Date.now()}`;
            const diagnostic = startBackgroundDiagnostic('worker', 'Stack suggestion analysis', {
                requestId,
                imageCount: images.length,
            });
            let finished = false;

            const finish = (status: 'finished' | 'cancelled' | 'failed') => {
                if (finished) return;
                finished = true;
                diagnostic.finish(status);
            };

            const handler = (e: MessageEvent) => {
                const data = e.data as { requestId?: string; type?: string; groups: StackGroup[]; error?: unknown };
                if (data.requestId === requestId) {
                    if (data.type === 'stacks-result') {
                        setSuggestedStacks(data.groups);
                    }
                    setIsCalculating(false);
                    worker.removeEventListener('message', handler);
                    if (activeWorkerCleanupRef.current === cleanupWorkerListener) {
                        activeWorkerCleanupRef.current = null;
                    }
                    finish(data.error ? 'failed' : 'finished');
                }
            };

            const cleanupWorkerListener = () => {
                worker.removeEventListener('message', handler);
                finish('cancelled');
            };

            activeWorkerCleanupRef.current = cleanupWorkerListener;
            worker.addEventListener('message', handler);

            // Send lightweight payload
            const payload = images.map((img) => ({
                id: img.id,
                timestamp: img.timestamp,
                width: img.width,
                height: img.height,
                groupId: img.groupId,
                metadata: {
                    positivePrompt: img.metadata.positivePrompt,
                    seed: img.metadata.seed,
                    model: readModelName(img.metadata.model),
                    steps: img.metadata.steps,
                    cfg: img.metadata.cfg,
                    variationId: img.metadata.variationId,
                    controlNets: img.metadata.controlNets,
                    ipAdapters: img.metadata.ipAdapters,
                },
            }));

            worker.postMessage({ type: 'analyze-stacks', images: payload, requestId });
        }, 500); // 500ms debounce

        return () => {
            clearTimeout(timeoutRef.current!);
            activeWorkerCleanupRef.current?.();
            activeWorkerCleanupRef.current = null;
        };
    }, [images]);

    return { suggestedStacks, isCalculating };
};
