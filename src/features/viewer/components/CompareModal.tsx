import * as React from 'react';
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCcw, ArrowRightLeft, Columns, Layers, PanelLeft, ChevronRight, Sidebar, SplitSquareHorizontal, Heart, GitCompare, Eye, EyeOff } from 'lucide-react';
import { AIImage } from '../../../types';
import { SmartImage } from '../../library/components/SmartImage';
import { getFilename } from '../../../utils/pathUtils';

interface CompareModalProps {
    imageA: AIImage;
    imageB: AIImage;
    onClose: () => void;
    onToggleFavorite: (id: string) => void;
}

type CompareMode = 'split' | 'slider' | 'overlay';
type DiffMode = 'diff' | 'raw';

// Extracted Component to prevent re-renders
const ImageContainer = ({
    img,
    side,
    position,
    scale,
    isDraggingCanvas,
    onToggleFavorite
}: {
    img: AIImage,
    side: 'left' | 'right',
    position: { x: number, y: number },
    scale: number,
    isDraggingCanvas: boolean,
    onToggleFavorite: (id: string) => void
}) => (
    <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        {/* Filename Tag */}
        <div className={`absolute top-6 ${side === 'left' ? 'left-6' : 'right-6'} z-20 bg-black/70 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10 shadow-xl pointer-events-none`}>
            <div className="text-white text-xs font-bold">{getFilename(img.filename)}</div>
            <div className="text-[10px] text-gray-400 font-mono mt-0.5">{img.width}x{img.height} • {img.metadata.model}</div>
        </div>

        {/* Heart Overlay */}
        <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(img.id);
            }}
            className={`absolute top-6 ${side === 'left' ? 'left-6 mt-14' : 'right-6 mt-14'} z-30 p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-all group cursor-pointer pointer-events-auto border border-white/10`}
            title={img.isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
            <Heart className={`w-4 h-4 transition-transform group-hover:scale-110 ${img.isFavorite ? 'fill-red-500 text-red-500' : 'text-white'}`} />
        </button>

        {/* Image Transform */}
        <div
            className="w-full h-full flex items-center justify-center p-6 box-border"
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transition: isDraggingCanvas ? 'none' : 'transform 0.1s ease-out' }}
        >
            <SmartImage
                src={img.url}
                alt={img.filename}
                className="w-full h-full"
                imgClassName="w-full h-full object-contain shadow-2xl"
                draggable={false}
                objectFit="contain"
            />
        </div>
    </div>
);

export const CompareModal: React.FC<CompareModalProps> = ({
    imageA,
    imageB,
    onClose,
    onToggleFavorite
}) => {
    // View State
    const [mode, setMode] = useState<CompareMode>('split');
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [sliderPos, setSliderPos] = useState(50);
    const [diffMode, setDiffMode] = useState<DiffMode>('diff');

    const [panelWidth, setPanelWidth] = useState(400); // Widened for diff view
    const [isPanelOpen, setIsPanelOpen] = useState(true);

    // Interaction Refs
    const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
    const [isDraggingSlider, setIsDraggingSlider] = useState(false);

    const dragStartRef = useRef({ x: 0, y: 0 });
    const sliderRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // --- Zoom/Pan Handlers ---
    const handleWheel = (e: React.WheelEvent) => {
        e.stopPropagation();
        const delta = e.deltaY * -0.001;
        const newScale = Math.min(Math.max(1, scale + delta), 5);
        setScale(newScale);
        if (newScale === 1) setPosition({ x: 0, y: 0 });
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (scale > 1 && !isDraggingSlider) {
            setIsDraggingCanvas(true);
            dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDraggingCanvas && scale > 1) {
            e.preventDefault();
            setPosition({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
            });
        }

        if (isDraggingSlider && containerRef.current) {
            e.preventDefault();
            const rect = containerRef.current.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            setSliderPos((x / rect.width) * 100);
        }
    };

    const handleMouseUp = () => {
        setIsDraggingCanvas(false);
        setIsDraggingSlider(false);
    };

    const resetZoom = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

    // --- Resize Logic ---
    const startPanelResize = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = panelWidth;

        const doResize = (moveEvent: MouseEvent) => {
            const newW = Math.min(800, Math.max(300, startW + (startX - moveEvent.clientX)));
            setPanelWidth(newW);
        };
        const stopResize = () => {
            window.removeEventListener('mousemove', doResize);
            window.removeEventListener('mouseup', stopResize);
        };
        window.addEventListener('mousemove', doResize);
        window.addEventListener('mouseup', stopResize);
    };

    const handleSliderMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDraggingSlider(true);
    };

    const DiffRow = ({ label, valA, valB }: { label: string, valA: string | number, valB: string | number }) => {
        const isDiff = valA !== valB;
        return (
            <div className={`grid grid-cols-1 gap-1 py-3 border-b border-white/5 text-sm hover:bg-white/5 transition-colors ${isDiff ? 'bg-yellow-900/10' : ''}`}>
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider px-4 mb-1">{label}</div>
                <div className="grid grid-cols-2 gap-4 px-4">
                    <div className={`truncate ${isDiff ? 'text-yellow-400 font-medium' : 'text-gray-400'}`} title={String(valA)}>{valA}</div>
                    <div className={`truncate ${isDiff ? 'text-yellow-400 font-medium' : 'text-gray-400'}`} title={String(valB)}>{valB}</div>
                </div>
            </div>
        );
    };

    // --- Diffing Logic ---
    const renderPromptDiff = (promptA: string, promptB: string) => {
        const wordsA = promptA.split(/(\s+)/);
        const wordsB = promptB.split(/(\s+)/);

        const setA = new Set(promptA.split(/\s+/).map(w => w.toLowerCase().replace(/[^\w]/g, '')));
        const setB = new Set(promptB.split(/\s+/).map(w => w.toLowerCase().replace(/[^\w]/g, '')));

        const renderDiffWords = (text: string, comparisonSet: Set<string>, colorClass: string) => {
            return text.split(/(\s+)/).map((part, i) => {
                if (part.match(/^\s+$/)) return <span key={i}>{part}</span>;
                const clean = part.toLowerCase().replace(/[^\w]/g, '');
                const isDiff = clean.length > 0 && !comparisonSet.has(clean);
                return (
                    <span key={i} className={isDiff ? `${colorClass} px-0.5 rounded text-white font-bold` : ''}>
                        {part}
                    </span>
                );
            });
        };

        return (
            <div className="space-y-4">
                {/* Left Prompt (A) */}
                <div className="space-y-1">
                    <div className="text-[10px] uppercase text-gray-500 font-bold">Original (Image A)</div>
                    <div className="p-3 bg-zinc-900/50 rounded-lg border border-white/5 text-xs text-gray-400 font-mono leading-relaxed">
                        {renderDiffWords(promptA, setB, 'bg-red-500/50')}
                    </div>
                </div>

                {/* Right Prompt (B) */}
                <div className="space-y-1">
                    <div className="text-[10px] uppercase text-gray-500 font-bold">New (Image B)</div>
                    <div className="p-3 bg-zinc-900/50 rounded-lg border border-white/5 text-xs text-gray-400 font-mono leading-relaxed">
                        {renderDiffWords(promptB, setA, 'bg-green-500/50')}
                    </div>
                </div>
            </div>
        );
    };

    const renderRawPrompt = (prompt: string, title: string) => (
        <div className="space-y-1">
            <div className="text-[10px] uppercase text-gray-500 font-bold">{title}</div>
            <div className="p-3 bg-zinc-900/50 rounded-lg border border-white/5 text-xs text-gray-400 font-mono leading-relaxed whitespace-pre-wrap">
                {prompt}
            </div>
        </div>
    );

    const commonImageProps = { position, scale, isDraggingCanvas, onToggleFavorite };

    return (
        <div
            className="fixed inset-0 z-[70] bg-black flex flex-col animate-in fade-in duration-200"
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onMouseMove={handleMouseMove}
            onClick={onClose}
        >

            {/* Darkened Header - Standardized to zinc-950/black */}
            <div
                className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-zinc-950 flex-shrink-0 z-50"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 text-gray-200 font-bold">
                        <ArrowRightLeft className="w-5 h-5 text-sage-500" />
                        Comparison
                    </div>

                    <div className="flex bg-black rounded-lg p-0.5 border border-white/10">
                        <button onClick={() => setMode('split')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'split' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`} title="Side by Side">Split</button>
                        <button onClick={() => setMode('slider')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'slider' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`} title="Slider Swipe">Swipe</button>
                        <button onClick={() => setMode('overlay')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'overlay' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`} title="Hover Overlay">Overlay</button>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-black rounded-full px-3 py-1 border border-white/10">
                        <button onClick={() => setScale(Math.max(1, scale - 0.5))} className="p-1 hover:text-white text-gray-500"><ZoomOut className="w-4 h-4" /></button>
                        <span className="text-xs font-mono text-gray-400 w-12 text-center">{Math.round(scale * 100)}%</span>
                        <button onClick={() => setScale(Math.min(5, scale + 0.5))} className="p-1 hover:text-white text-gray-500"><ZoomIn className="w-4 h-4" /></button>
                        <div className="w-px h-3 bg-white/10 mx-1" />
                        <button onClick={resetZoom} className="p-1 hover:text-white text-gray-500" title="Reset Zoom"><RotateCcw className="w-4 h-4" /></button>
                    </div>

                    <div className="h-6 w-px bg-white/10" />

                    <button
                        onClick={() => setIsPanelOpen(!isPanelOpen)}
                        className={`p-2 rounded-lg transition-colors ${isPanelOpen ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
                        title="Toggle Diff Sidebar"
                    >
                        <Sidebar className="w-5 h-5" />
                    </button>

                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">

                {/* Main Canvas Area */}
                <div
                    ref={containerRef}
                    className="flex-1 flex overflow-hidden relative bg-[#050505] select-none"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onClick={e => e.stopPropagation()}
                >

                    {/* SPLIT */}
                    {mode === 'split' && (
                        <>
                            <div className="flex-1 border-r border-white/5 overflow-hidden relative">
                                <ImageContainer img={imageA} side="left" {...commonImageProps} />
                            </div>
                            <div className="flex-1 overflow-hidden relative">
                                <ImageContainer img={imageB} side="right" {...commonImageProps} />
                            </div>
                        </>
                    )}

                    {/* SLIDER */}
                    {mode === 'slider' && (
                        <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 flex items-center justify-center">
                                <ImageContainer img={imageB} side="right" {...commonImageProps} />
                            </div>
                            <div
                                className="absolute inset-0 flex items-center justify-center bg-[#050505] border-r border-sage-500 shadow-[2px_0_20px_rgba(0,0,0,0.8)]"
                                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                            >
                                <ImageContainer img={imageA} side="left" {...commonImageProps} />
                            </div>
                            <div
                                ref={sliderRef}
                                className="absolute top-0 bottom-0 w-1 bg-sage-500 cursor-ew-resize z-40 hover:bg-sage-400 transition-colors flex items-center justify-center group"
                                style={{ left: `${sliderPos}%` }}
                                onMouseDown={handleSliderMouseDown}
                            >
                                <div className="w-8 h-8 rounded-full bg-sage-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                    <ArrowRightLeft className="w-4 h-4 text-white" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* OVERLAY */}
                    {mode === 'overlay' && (
                        <div className="w-full h-full relative overflow-hidden flex items-center justify-center group">
                            <div className="absolute inset-0 flex items-center justify-center">
                                <ImageContainer img={imageA} side="left" {...commonImageProps} />
                            </div>
                            <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto">
                                <ImageContainer img={imageB} side="right" {...commonImageProps} />
                            </div>
                            <div className="absolute bottom-12 bg-black/80 text-white px-4 py-2 rounded-full text-xs pointer-events-none border border-white/10 backdrop-blur-md">
                                Hover to reveal <span className="font-bold text-sage-400">{getFilename(imageB.filename)}</span>
                            </div>
                        </div>
                    )}

                </div>

                {/* Right Sidebar - With Animation */}
                <div
                    style={{ width: isPanelOpen ? `${panelWidth}px` : '0px' }}
                    className={`bg-[#0a0a0a] border-l border-white/10 flex flex-col flex-shrink-0 relative shadow-2xl z-20 transition-all duration-500 ease-spring overflow-hidden ${isPanelOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-20'}`}
                    onClick={e => e.stopPropagation()}
                >
                    <div
                        className="absolute left-0 top-0 bottom-0 w-1 hover:w-1.5 bg-transparent hover:bg-sage-500 cursor-ew-resize transition-all z-20"
                        onMouseDown={startPanelResize}
                    />

                    <div className="p-4 border-b border-white/10 flex items-center justify-between bg-zinc-950 min-w-[300px]">
                        <h3 className="font-bold text-gray-200 text-sm flex items-center gap-2 uppercase tracking-wide">
                            <GitCompare className="w-4 h-4 text-sage-500" />
                            Differences
                        </h3>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar min-w-[300px]">
                        <div className="grid grid-cols-2 gap-4 px-4 py-4 bg-zinc-900/20 border-b border-white/10 text-xs font-mono text-gray-500">
                            <div className="truncate text-center" title={imageA.filename}>{getFilename(imageA.filename)}</div>
                            <div className="truncate text-center" title={imageB.filename}>{getFilename(imageB.filename)}</div>
                        </div>

                        <DiffRow label="Model" valA={imageA.metadata.model} valB={imageB.metadata.model} />
                        <DiffRow label="Seed" valA={imageA.metadata.seed} valB={imageB.metadata.seed} />
                        <DiffRow label="Steps" valA={imageA.metadata.steps} valB={imageB.metadata.steps} />
                        <DiffRow label="CFG" valA={imageA.metadata.cfg} valB={imageB.metadata.cfg} />
                        <DiffRow label="Size" valA={`${imageA.width}x${imageA.height}`} valB={`${imageB.width}x${imageB.height}`} />

                        <div className="p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="text-xs text-gray-500 font-bold uppercase tracking-wider">Prompt Diff</div>
                                <div className="flex items-center gap-2">
                                    {diffMode === 'diff' && (
                                        <div className="flex gap-2 text-[10px] mr-2">
                                            <span className="text-red-400 bg-red-900/20 px-1.5 py-0.5 rounded">Removed</span>
                                            <span className="text-green-400 bg-green-900/20 px-1.5 py-0.5 rounded">Added</span>
                                        </div>
                                    )}
                                    <div className="flex bg-black rounded-lg p-0.5 border border-white/10">
                                        <button onClick={() => setDiffMode('diff')} className={`p-1 rounded ${diffMode === 'diff' ? 'bg-white/10 text-white' : 'text-gray-500'}`} title="Diff View"><Eye className="w-3 h-3" /></button>
                                        <button onClick={() => setDiffMode('raw')} className={`p-1 rounded ${diffMode === 'raw' ? 'bg-white/10 text-white' : 'text-gray-500'}`} title="Raw View"><EyeOff className="w-3 h-3" /></button>
                                    </div>
                                </div>
                            </div>

                            {imageA.metadata.positivePrompt === imageB.metadata.positivePrompt ? (
                                <div className="text-sm text-gray-600 italic text-center py-4 bg-zinc-900/30 rounded-lg">Prompts are identical</div>
                            ) : (
                                diffMode === 'diff' ? (
                                    renderPromptDiff(imageA.metadata.positivePrompt, imageB.metadata.positivePrompt)
                                ) : (
                                    <div className="space-y-4">
                                        {renderRawPrompt(imageA.metadata.positivePrompt, "Original (Image A)")}
                                        {renderRawPrompt(imageB.metadata.positivePrompt, "New (Image B)")}
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
