import * as React from 'react';
import { useEffect, useState, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Share2, Minimize2, Maximize2, Heart, Trash2, PanelRightClose, PanelRightOpen, Copy, Wand2, Shuffle, Layers, ArrowRight, Layout, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AIImage, GeneratorTool } from '../types';
import { useZoomPan } from '../hooks/useZoomPan';
import { ImageCanvas } from './viewer/ImageCanvas';
import { MetadataSidebar } from './viewer/MetadataSidebar';
import { usePalette } from '../hooks/usePalette';
import { useImageAI } from '../hooks/useImageAI';
import { useLibraryContext } from '../hooks/useLibraryContext';

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
}

// AI Result Modal Component (Local to Viewer)
const AIResultModal = ({ isOpen, onClose, type, content, onCopy }: { isOpen: boolean; onClose: () => void; type: 'analysis' | 'variations'; content: string | string[] | null; onCopy: (text: string) => void; }) => {
    if (!isOpen || !content) return null;
    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-white/5 shrink-0">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {type === 'analysis' ? <Wand2 className="w-4 h-4 text-amethyst-500" /> : <Shuffle className="w-4 h-4 text-amethyst-500" />}
                        {type === 'analysis' ? 'Prompt Analysis' : 'Creative Variations'}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {type === 'analysis' ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            <ReactMarkdown>{content as string}</ReactMarkdown>
                        </div>
                    ) : (
                        <div className="space-y-3">{(content as string[]).map((variation, i) => (
                            <div key={i} className="group relative p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 hover:border-amethyst-500/30 transition-colors">
                                <p className="text-sm text-gray-700 dark:text-gray-300 pr-8 leading-snug">{variation}</p>
                                <button onClick={() => onCopy(variation)} className="absolute top-2 right-2 p-1.5 rounded-md bg-white dark:bg-black/40 text-gray-400 hover:text-amethyst-500 opacity-0 group-hover:opacity-100 transition-opacity"><Copy className="w-3.5 h-3.5" /></button>
                            </div>
                        ))}</div>
                    )}
                </div>
            </div>
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
    onToggleSidebar
}) => {
    const { collections, settings } = useLibraryContext();

    // --- Stack / Version Logic ---
    const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

    // Reset local version when navigating to a new parent image
    useEffect(() => {
        setActiveVersionId(null);
    }, [image.id]);

    const versions = useMemo(() => {
        if (!image.stack || image.stack.length === 0) return [];
        // Sort: Smallest resolution (base) first, largest/newest last
        return [...image.stack].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    }, [image]);

    const displayImage = useMemo(() => {
        if (!activeVersionId) return image;
        return versions.find(v => v.id === activeVersionId) || image;
    }, [image, versions, activeVersionId]);

    // --- Hooks ---
    const { scale, position, isDragging, resetZoom, handlers } = useZoomPan();
    const { palette, isLoading: isPaletteLoading } = usePalette(displayImage.url);
    const ai = useImageAI(settings.googleGeminiApiKey, settings.enableAI);

    // --- UI State ---
    const [activeTab, setActiveTab] = useState<'info' | 'edit' | 'workflow'>('info');
    const [isZenMode, setIsZenMode] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Buffers (Notes/Prompt editing local to displayImage) ---
    const [notes, setNotes] = useState(displayImage.notes || '');
    const [promptValue, setPromptValue] = useState(displayImage.metadata.positivePrompt || '');

    // Sync state when display image changes (version switch or nav)
    useEffect(() => {
        setNotes(displayImage.notes || '');
        setPromptValue(displayImage.metadata.positivePrompt || '');
        resetZoom();
        ai.closeModal();
    }, [displayImage.id, displayImage.metadata.positivePrompt, resetZoom]);

    // Theater Mode Controls Auto-Hide
    useEffect(() => {
        if (isSidebarOpen && !isZenMode) {
            setShowControls(true);
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        } else {
            controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
        }
        return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); };
    }, [isSidebarOpen, isZenMode, scale]);

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
            if (key === 'f') onToggleFavorite(displayImage.id);
            if (key === 'p') onTogglePin?.(displayImage.id, !displayImage.isPinned);
            if (key === 'i') onToggleSidebar?.();

            if (e.key === 'Escape') {
                if (ai.modalOpen) ai.closeModal();
                else if (isZenMode) setIsZenMode(false);
                else onClose();
            }
            if (key === 'z') setIsZenMode(p => !p);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, ai.modalOpen, isZenMode, onNext, onPrev, onToggleFavorite, onTogglePin, onToggleSidebar, displayImage, onClose]);

    if (!isOpen) return null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className={`fixed inset-0 z-50 flex bg-gray-950/95 ${isZenMode ? 'bg-black' : 'backdrop-blur-md'}`}
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
                {/* Floating Toolbar */}
                <div className={`absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black via-black/50 to-transparent pointer-events-none transition-opacity duration-500 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="flex flex-col items-start pointer-events-auto">
                        <div className="text-gray-300 text-sm font-mono bg-black/50 px-3 py-1.5 rounded-lg border border-white/10 backdrop-blur-md shadow-xl">
                            {displayImage.filename}
                        </div>
                        {versions.length > 0 && (
                            <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-sage-400 bg-sage-900/30 px-2 py-1 rounded border border-sage-500/20">
                                <Layers className="w-3 h-3" />
                                <span>Version {versions.findIndex(v => v.id === displayImage.id) + 1} of {versions.length}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3 pointer-events-auto">
                        <button
                            onClick={async () => {
                                try {
                                    const response = await fetch(displayImage.url);
                                    const blob = await response.blob();
                                    await navigator.clipboard.write([
                                        new ClipboardItem({ [blob.type]: blob })
                                    ]);
                                    // We need toast here, but Toast is in App. 
                                    // Since we don't have onToast prop, we'll use a small local feedback or just trust the global state if we can pass it.
                                    // For now, let's just do it.
                                } catch (e) {
                                    console.error("Copy failed", e);
                                }
                            }}
                            className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                            title="Copy Image to Clipboard"
                        >
                            <Copy className="w-5 h-5" />
                        </button>
                        <button
                            onClick={async () => {
                                const { invoke } = await import('@tauri-apps/api/core');
                                await invoke('open_file', { path: displayImage.id });
                            }}
                            className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                            title="Open in Default App"
                        >
                            <ExternalLink className="w-5 h-5" />
                        </button>
                        <button onClick={() => setIsZenMode(!isZenMode)} className={`p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full transition-all backdrop-blur-md shadow-lg ${isZenMode ? 'text-sage-400 border-sage-500/50' : 'text-white/50 hover:text-white'}`}>
                            <Layout className="w-5 h-5" />
                        </button>
                        <button onClick={() => { if (navigator.share) navigator.share({ title: displayImage.filename, url: displayImage.url }); }} className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"><Share2 className="w-5 h-5" /></button>
                        <button onClick={() => onToggleFavorite(displayImage.id)} className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"><Heart className={`w-5 h-5 ${displayImage.isFavorite ? 'fill-red-500 text-red-500' : ''}`} /></button>
                        {onDelete && <button onClick={() => onDelete(displayImage.id)} className="p-2.5 bg-black/50 hover:bg-red-500/20 border border-white/5 hover:border-red-500/30 rounded-full text-white/50 hover:text-red-400 transition-all backdrop-blur-md shadow-lg"><Trash2 className="w-5 h-5" /></button>}
                        {onToggleSidebar && !isZenMode && <button onClick={onToggleSidebar} className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg">{isSidebarOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}</button>}
                        <button onClick={onClose} className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"><X className="w-5 h-5" /></button>
                    </div>
                </div>

                <ImageCanvas
                    image={displayImage}
                    scale={scale}
                    position={position}
                    isDragging={isDragging}
                    showControls={showControls}
                    onPrev={onPrev}
                    onNext={onNext}
                    onClose={onClose}
                    onZoomIn={() => handlers.onWheel({ deltaY: -100 } as any)}
                    onZoomOut={() => handlers.onWheel({ deltaY: 100 } as any)}
                    onResetZoom={resetZoom}
                    isZenMode={isZenMode}
                    onToggleZen={() => setIsZenMode(!isZenMode)}
                    handlers={handlers}
                />

                {/* Version Selector (Bottom Center) */}
                {versions.length > 1 && (
                    <div className={`absolute bottom-24 left-1/2 -translate-x-1/2 z-30 flex items-end gap-3 p-2 rounded-2xl bg-black/70 backdrop-blur-md border border-white/10 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
                        {versions.map((v, idx) => {
                            const isActive = v.id === displayImage.id;
                            const isUpscale = v.width > versions[0].width;
                            return (
                                <button
                                    key={v.id}
                                    onClick={(e) => { e.stopPropagation(); setActiveVersionId(v.id); }}
                                    className={`relative group/thumb w-14 h-20 rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-pointer ${isActive ? 'border-sage-500 scale-110 z-10 shadow-[0_0_15px_rgba(115,140,85,0.5)]' : 'border-transparent opacity-60 hover:opacity-100 hover:scale-105 hover:border-white/20'}`}
                                >
                                    <img src={v.thumbnailUrl} className="w-full h-full object-cover" alt="" />

                                    {/* Resolution Badge */}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-white text-center py-0.5 font-mono">
                                        {v.width}w
                                    </div>

                                    {/* Upscale Icon */}
                                    {isUpscale && (
                                        <div className="absolute top-1 right-1 p-0.5 bg-amethyst-500 rounded-full shadow-sm">
                                            <ArrowRight className="w-2 h-2 text-white -rotate-45" />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

            </div>

            {/* Right Area: Sidebar */}
            <div className={`h-full z-30 transition-all duration-500 ease-spring overflow-hidden ${isSidebarOpen && !isZenMode ? 'w-[420px] opacity-100 translate-x-0' : 'w-0 opacity-0 translate-x-20'}`}>
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
                    onUpdateNotes={(id, n) => onUpdateNotes?.(id, n)}
                    onUpdatePrompt={(id, p) => onUpdatePrompt?.(id, p)}
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