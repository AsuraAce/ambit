import * as React from 'react';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Heart, Pin } from 'lucide-react';
import { AIImage, GeneratorTool } from '../../../types';
import { useZoomPan } from '../../../hooks/useZoomPan';
import { ImageCanvas } from './ImageCanvas';
import { MetadataSidebar } from './MetadataSidebar';
import { usePalette } from '../../../hooks/usePalette';
import { useImageAI } from '../../../hooks/useImageAI';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useCollectionStore } from '../../../stores/collectionStore';
import { ensureAssetPathAccessible } from '../../../services/assetScope';
import { getFilename } from '../../../utils/pathUtils';
import { getImageWithFullMetadata } from '../../../services/db/imageRepo';
import { useToast } from '../../../hooks/useToast';
import type { PromptHighlightSpec } from '../utils/searchHighlights';
import { isOsOpenUnavailable, openFileInDefaultApp } from '../../../services/osOpen';
import {
    getEffectiveAiModel,
    getEffectiveAiThinkingMode,
    getEffectiveSystemPrompts
} from '../../../utils/settingsUtils';

interface ImageViewerProps {
    image: AIImage;
    availableTags?: string[];
    onAddToCollection: (imageId: string, collectionId: string) => void;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    onSearch: (term: string) => void;
    onUpdateNotes?: (imageId: string, notes: string) => void;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, negativePrompt: string) => void;
    onUpdateModel?: (imageId: string, newModel: string) => void;
    onUpdateTool?: (imageId: string, tool: GeneratorTool) => void;
    onToggleFavorite: (id: string) => void;
    onTogglePin?: (id: string, isPinned: boolean) => void;
    onRecoverMetadata?: () => void;
    onRevertMetadata?: (imageId: string) => void;
    onOpenSettings: () => void;
    onDelete?: (id: string) => void;
    isOpen: boolean;
    isSidebarOpen?: boolean;
    onToggleSidebar?: () => void;
    searchHighlights?: PromptHighlightSpec;
}

import { AIResultModal } from './AIResultModal';
import { ViewerToolbar } from './ViewerToolbar';
import { VersionSelector } from './VersionSelector';

interface ViewerStatusHudProps {
    isFavorite: boolean;
    isPinned: boolean;
    isVisible: boolean;
}

const ViewerStatusHud: React.FC<ViewerStatusHudProps> = ({ isFavorite, isPinned, isVisible }) => {
    const statuses = [
        {
            key: 'favorite',
            active: isFavorite,
            Icon: Heart,
            activeClass: 'border-red-400/40 bg-red-500/15 text-red-400 shadow-red-950/30',
            inactiveClass: 'border-white/10 bg-black/30 text-white/35',
            iconClass: isFavorite ? 'fill-current' : '',
        },
        {
            key: 'pin',
            active: isPinned,
            Icon: Pin,
            activeClass: 'border-sage-400/40 bg-sage-500/15 text-sage-300 shadow-sage-950/30',
            inactiveClass: 'border-white/10 bg-black/30 text-white/35',
            iconClass: isPinned ? 'fill-current' : '',
        },
    ];

    if (!isVisible && !isFavorite && !isPinned) return null;

    const label = [
        isFavorite ? 'liked' : 'not liked',
        isPinned ? 'pinned' : 'not pinned',
    ].join(', ');

    return (
        <div
            className="absolute bottom-8 right-8 z-20 flex items-center gap-2 pointer-events-none transition-opacity duration-300"
            role="status"
            aria-live="polite"
            aria-label={label}
        >
            {statuses.map(({ key, active, Icon, activeClass, inactiveClass, iconClass }) => (
                <div
                    key={key}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md shadow-lg transition-all duration-300 ${active ? activeClass : inactiveClass} ${isVisible || active ? 'opacity-100 scale-100' : 'opacity-0 scale-100'}`}
                >
                    <Icon className={`h-4 w-4 ${iconClass}`} />
                </div>
            ))}
        </div>
    );
};

export const ImageViewer: React.FC<ImageViewerProps> = ({
    image,
    availableTags = [],
    onAddToCollection,
    onClose,
    onNext,
    onPrev,
    onSearch,
    onUpdateNotes,
    onUpdatePrompt,
    onUpdateNegativePrompt,
    onUpdateModel,
    onUpdateTool,
    onToggleFavorite,
    onTogglePin,
    onRecoverMetadata,
    onRevertMetadata,
    onOpenSettings,
    onDelete,
    isOpen,
    isSidebarOpen = true,
    onToggleSidebar,
    searchHighlights
}) => {
    const settings = useSettingsStore(s => s.settings);
    const privacyExposureBlocked = useSettingsStore(state => (
        state.privacyEnabled && state.privacyMaskIndexStatus !== 'ready'
    ));
    const collections = useCollectionStore(s => s.collections);
    const [fullImage, setFullImage] = useState<AIImage | null>(null);
    const [isLoadingFull, setIsLoadingFull] = useState(false);

    // --- Stack / Version Logic ---
    const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

    // Reset local version when navigating to a new parent image
    useEffect(() => {
        setActiveVersionId(null);
    }, [image.id]);

    // Reset local version and/or fetch full metadata when image or version changes
    useEffect(() => {
        if (privacyExposureBlocked) {
            setFullImage(null);
            setIsLoadingFull(false);
            return;
        }
        const targetId = activeVersionId || image.id;
        // Optimization: Only clear if it's a completely different image, 
        // keep old one as placeholder if it's just a version switch? 
        // No, let's clear to avoid confusing metadata flicker.
        setFullImage(null);
        setIsLoadingFull(true);

        getImageWithFullMetadata(targetId).then(res => {
            if (res) setFullImage(res);
            setIsLoadingFull(false);
        }).catch(() => setIsLoadingFull(false));
    }, [image.id, activeVersionId, privacyExposureBlocked]);

    const versions = useMemo(() => {
        if (!image.stack || image.stack.length === 0) return [];
        // Sort: Smallest resolution (base) first, largest/newest last
        return [...image.stack].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    }, [image]);

    const displayImage = useMemo(() => {
        // Use full image if available, else fallback to partial
        // CRITICAL FIX: Only use fullImage if its ID matches the current target ID.
        // This avoids merging metadata from two different images during a navigation transition.
        const targetId = activeVersionId || image.id;
        const isCorrectImage = fullImage && fullImage.id === targetId;

        const base = isCorrectImage ? {
            ...fullImage,
            ...image, // Prioritize reactive props (isFavorite, notes, etc)
            metadata: {
                ...fullImage.metadata,
                positivePrompt: image.metadata.positivePrompt,
                negativePrompt: image.metadata.negativePrompt,
                tool: image.metadata.tool,
                ...(image.metadata.overrideModel !== undefined
                    ? { overrideModel: image.metadata.overrideModel }
                    : {})
            },
            originalMetadata: image.originalMetadata ?? fullImage.originalMetadata,
            originalChunks: image.originalChunks ?? fullImage.originalChunks,
            originalState: image.originalState ?? fullImage.originalState,
        } : image;

        if (!activeVersionId) return base;
        return versions.find(v => v.id === activeVersionId) || base;
    }, [image, fullImage, versions, activeVersionId]);

    // Derive loading state synchronously to avoid flash
    const isReallyLoading = isLoadingFull || (activeVersionId ? (fullImage?.id !== activeVersionId) : (fullImage?.id !== image.id));

    // --- Hooks ---
    const { scale, position, isDragging, resetZoom, zoomIn, zoomOut, handlers } = useZoomPan();
    const { palette, isLoading: isPaletteLoading } = usePalette(
        privacyExposureBlocked ? null : displayImage.url
    );
    const { addToast } = useToast();
    const ai = useImageAI({
        aiModel: getEffectiveAiModel(settings),
        aiThinkingMode: getEffectiveAiThinkingMode(settings),
        enableAI: settings.enableAI,
        prompts: getEffectiveSystemPrompts(settings),
        onError: (msg) => addToast(msg, 'error')
    });

    // --- UI State ---
    const [activeTab, setActiveTab] = useState<'info' | 'edit' | 'workflow'>('info');
    const [isTheaterMode, setIsTheaterMode] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [showStatusHud, setShowStatusHud] = useState(true);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusHudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Buffers (Notes/Prompt editing local to displayImage) ---
    const [notes, setNotes] = useState(displayImage.notes || '');
    const [promptValue, setPromptValue] = useState(displayImage.metadata.positivePrompt || '');
    const [negativePromptValue, setNegativePromptValue] = useState(displayImage.metadata.negativePrompt || '');

    // Sync state when display image changes (version switch or nav)
    useEffect(() => {
        setNotes(displayImage.notes || '');
        setPromptValue(displayImage.metadata.positivePrompt || '');
        setNegativePromptValue(displayImage.metadata.negativePrompt || '');
        resetZoom();
        ai.closeModal();
    }, [
        displayImage.id,
        displayImage.metadata.positivePrompt,
        displayImage.metadata.negativePrompt,
        displayImage.originalMetadata,
        resetZoom
    ]);

    useEffect(() => {
        void ensureAssetPathAccessible(displayImage.url).catch((error) => {
            console.warn('[ImageViewer] Failed to register image path for viewer', error);
        });
    }, [displayImage.url]);

    const revealStatusHud = useCallback((duration = 1600) => {
        setShowStatusHud(true);
        if (statusHudTimeoutRef.current) clearTimeout(statusHudTimeoutRef.current);
        statusHudTimeoutRef.current = setTimeout(() => setShowStatusHud(false), duration);
    }, []);

    useEffect(() => {
        revealStatusHud();
        return () => {
            clearTimeout(statusHudTimeoutRef.current as ReturnType<typeof setTimeout>);
        };
    }, [displayImage.id, revealStatusHud]);

    const handleToggleFavorite = useCallback(() => {
        onToggleFavorite(displayImage.id);
        revealStatusHud(2000);
    }, [displayImage.id, onToggleFavorite, revealStatusHud]);

    const handleTogglePin = useCallback(() => {
        onTogglePin?.(displayImage.id, !displayImage.isPinned);
        revealStatusHud(2000);
    }, [displayImage.id, displayImage.isPinned, onTogglePin, revealStatusHud]);

    // Theater Mode Controls Auto-Hide
    useEffect(() => {
        if (isSidebarOpen && !isTheaterMode) {
            setShowControls(true);
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        } else {
            controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
        }
        return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); };
    }, [isSidebarOpen, isTheaterMode, scale]);

    // Global Key Handlers for Viewer
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;
            // Don't trigger shortcuts if user is typing in a field
            if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

            const key = e.key.toLowerCase();

            // Navigation
            if (e.key === 'ArrowRight') onNext();
            if (e.key === 'ArrowLeft') onPrev();

            // Actions
            if (key === 'f') handleToggleFavorite();
            if (key === 'p') handleTogglePin();
            if (key === 'i') onToggleSidebar?.();

            if (e.key === 'Escape') {
                if (ai.modalOpen) ai.closeModal();
                else if (isTheaterMode) setIsTheaterMode(false);
                else onClose();
            }
            if (key === 'z') setIsTheaterMode(p => !p);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, ai.modalOpen, isTheaterMode, onNext, onPrev, handleToggleFavorite, handleTogglePin, onToggleSidebar, onClose]);

    useEffect(() => {
        if (isOpen && privacyExposureBlocked) onClose();
    }, [isOpen, onClose, privacyExposureBlocked]);

    if (!isOpen || privacyExposureBlocked) return null;

    const isSidebarVisible = isSidebarOpen && !isTheaterMode;

    const handleCopyImage = async () => {
        try {
            const response = await fetch(displayImage.url);
            const blob = await response.blob();
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ]);
        } catch (e) {
            console.error("Copy failed", e);
        }
    };

    const handleOpenExternal = async () => {
        const result = await openFileInDefaultApp(displayImage.id);
        if (result.status === 'error') {
            addToast(result.error, isOsOpenUnavailable(result.error) ? 'info' : 'error');
        }
    };

    const handleShare = () => {
        if (navigator.share) {
            navigator.share({ title: displayImage.filename, url: displayImage.url });
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className={`fixed inset-0 z-50 flex bg-gray-950/95 ${isTheaterMode ? 'bg-black' : 'backdrop-blur-md'}`}
        >

            {/* Left Area: Canvas */}
            <div
                className="flex-1 relative flex flex-col h-full overflow-hidden"
                onMouseMove={() => {
                    setShowControls(true);
                    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
                    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
                }}
            >
                <ViewerToolbar
                    image={displayImage}
                    versionsCount={versions.length}
                    activeVersionIndex={versions.findIndex(v => v.id === displayImage.id)}
                    showControls={showControls}
                    isTheaterMode={isTheaterMode}
                    isSidebarOpen={isSidebarOpen}
                    onCopy={handleCopyImage}
                    onOpenExternal={handleOpenExternal}
                    onToggleTheater={() => setIsTheaterMode(!isTheaterMode)}
                    onShare={handleShare}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePin={onTogglePin ? handleTogglePin : undefined}
                    onDelete={onDelete ? () => onDelete(displayImage.id) : undefined}
                    onToggleSidebar={onToggleSidebar}
                    onClose={onClose}
                />

                <ImageCanvas
                    image={displayImage}
                    scale={scale}
                    position={position}
                    isDragging={isDragging}
                    showControls={showControls}
                    onPrev={onPrev}
                    onNext={onNext}
                    onClose={onClose}
                    onZoomIn={zoomIn}
                    onZoomOut={zoomOut}
                    onResetZoom={resetZoom}
                    isTheaterMode={isTheaterMode}
                    onToggleTheater={() => setIsTheaterMode(!isTheaterMode)}
                    handlers={handlers}
                />

                <ViewerStatusHud
                    isFavorite={Boolean(displayImage.isFavorite)}
                    isPinned={Boolean(displayImage.isPinned)}
                    isVisible={showStatusHud}
                />

                <VersionSelector
                    versions={versions}
                    activeVersionId={displayImage.id}
                    onVersionSelect={setActiveVersionId}
                    showControls={showControls}
                />

            </div>

            {/* Right Area: Sidebar */}
            <div
                aria-hidden={!isSidebarVisible}
                inert={isSidebarVisible ? undefined : true}
                className={`h-full z-30 transition-all duration-500 ease-spring overflow-hidden ${isSidebarVisible ? 'w-[420px] opacity-100 translate-x-0' : 'w-0 opacity-0 translate-x-20'}`}
            >
                <MetadataSidebar
                    image={displayImage} // Pass active version
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    collections={collections}
                    availableTags={availableTags}
                    notes={notes}
                    setNotes={setNotes}
                    promptValue={promptValue}
                    setPromptValue={setPromptValue}
                    negativePromptValue={negativePromptValue}
                    setNegativePromptValue={setNegativePromptValue}
                    onUpdateNotes={(id, n) => onUpdateNotes?.(id, n)}
                    onUpdatePrompt={(id, p) => onUpdatePrompt?.(id, p)}
                    onUpdateNegativePrompt={(id, np) => onUpdateNegativePrompt?.(id, np)}
                    onUpdateModel={(id, m) => onUpdateModel?.(id, m)}
                    onUpdateTool={(id, t) => onUpdateTool?.(id, t)}
                    onAddToCollection={onAddToCollection}
                    onSearch={onSearch}
                    onClose={onClose}
                    onRecoverMetadata={onRecoverMetadata}
                    onRevertMetadata={onRevertMetadata}
                    onAIAnalysis={() => ai.analyzePrompt(displayImage.metadata.positivePrompt, onOpenSettings)}
                    onGenerateVariations={() => ai.generateVariations(displayImage.metadata.positivePrompt, onOpenSettings)}
                    isAnalyzing={ai.isAnalyzing}
                    onOpenAIResult={ai.result ? ai.openModal : undefined}
                    palette={palette}
                    isPaletteLoading={isPaletteLoading}
                    isLoading={isReallyLoading}
                    searchHighlights={searchHighlights}
                />
            </div>

            <AIResultModal
                isOpen={ai.modalOpen}
                onClose={ai.closeModal}
                type={ai.modalType}
                content={ai.result}
                onCopy={(t) => navigator.clipboard.writeText(t)}
            />
        </motion.div>
    );
};
