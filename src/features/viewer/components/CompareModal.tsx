import * as React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCcw, ArrowRightLeft, Columns, Layers, PanelLeft, ChevronRight, Sidebar, SplitSquareHorizontal, Heart, GitCompare, Eye, EyeOff, Pin } from 'lucide-react';
import { AIImage } from '../../../types';
import { SmartImage } from '../../library/components/SmartImage';
import { getFilename } from '../../../utils/pathUtils';
import {
    CENTER_ANCHOR,
    Point,
    ViewportRect,
    getAnchorPoint,
    getZoomTransform
} from '../../../utils/zoomMath';

interface CompareModalProps {
    imageA: AIImage;
    imageB: AIImage;
    onClose: () => void;
    onToggleFavorite: (id: string) => void;
    onTogglePin?: (id: string, isPinned: boolean) => void;
}

type CompareMode = 'split' | 'slider' | 'overlay';
type DiffMode = 'diff' | 'raw';

const COMPARE_MIN_SCALE = 1;
const COMPARE_MAX_SCALE = 5;
const COMPARE_BUTTON_ZOOM_STEP = 0.5;
const DIAGONAL_OFFSET_PX = 28;
const DIAGONAL_DIVIDER_WIDTH_PX = 4;
const CANVAS_PADDING_PX = 24;
const SLIDER_HIT_TARGET_WIDTH_PX = 80;
const SLIDER_EDGE_TRAVEL_PX = DIAGONAL_OFFSET_PX + Math.ceil(DIAGONAL_DIVIDER_WIDTH_PX / 2) + 2;

interface MediaFrame {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface CanvasSize {
    width: number;
    height: number;
}

const getCompareViewportRect = (
    containerRect: DOMRect,
    clientX: number,
    mode: CompareMode
): ViewportRect => {
    if (mode !== 'split') {
        return containerRect;
    }

    const halfWidth = containerRect.width / 2;
    const isRightPane = clientX >= containerRect.left + halfWidth;

    return {
        left: isRightPane ? containerRect.left + halfWidth : containerRect.left,
        top: containerRect.top,
        width: halfWidth,
        height: containerRect.height
    };
};

const getFittedRect = (
    imageWidth: number,
    imageHeight: number,
    availableWidth: number,
    availableHeight: number
): MediaFrame => {
    if (imageWidth <= 0 || imageHeight <= 0 || availableWidth <= 0 || availableHeight <= 0) {
        return {
            left: CANVAS_PADDING_PX,
            top: CANVAS_PADDING_PX,
            width: Math.max(0, availableWidth),
            height: Math.max(0, availableHeight)
        };
    }

    const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;

    return {
        left: CANVAS_PADDING_PX + (availableWidth - width) / 2,
        top: CANVAS_PADDING_PX + (availableHeight - height) / 2,
        width,
        height
    };
};

const getUnionFrame = (frameA: MediaFrame, frameB: MediaFrame): MediaFrame => {
    const left = Math.min(frameA.left, frameB.left);
    const top = Math.min(frameA.top, frameB.top);
    const right = Math.max(frameA.left + frameA.width, frameB.left + frameB.width);
    const bottom = Math.max(frameA.top + frameA.height, frameB.top + frameB.height);

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
};

const framesAreEqual = (frameA: MediaFrame, frameB: MediaFrame) => (
    Math.abs(frameA.left - frameB.left) < 0.5 &&
    Math.abs(frameA.top - frameB.top) < 0.5 &&
    Math.abs(frameA.width - frameB.width) < 0.5 &&
    Math.abs(frameA.height - frameB.height) < 0.5
);

const getZoomedFrame = (
    frame: MediaFrame,
    canvasSize: CanvasSize,
    position: { x: number, y: number },
    scale: number
): MediaFrame => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return frame;

    const originX = canvasSize.width / 2;
    const originY = canvasSize.height / 2;

    return {
        left: originX + position.x + (frame.left - originX) * scale,
        top: originY + position.y + (frame.top - originY) * scale,
        width: frame.width * scale,
        height: frame.height * scale
    };
};

const clampFrameToCanvas = (frame: MediaFrame, canvasSize: CanvasSize): MediaFrame => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return frame;

    const left = Math.max(0, frame.left);
    const top = Math.max(0, frame.top);
    const right = Math.min(canvasSize.width, frame.left + frame.width);
    const bottom = Math.min(canvasSize.height, frame.top + frame.height);

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
};

const ImageActions = ({
    img,
    side,
    onToggleFavorite,
    onTogglePin
}: {
    img: AIImage,
    side: 'left' | 'right',
    onToggleFavorite: (id: string) => void,
    onTogglePin?: (id: string, isPinned: boolean) => void
}) => (
    <div className={`absolute top-3 ${side === 'left' ? 'left-3' : 'right-3'} z-50 flex gap-2 pointer-events-auto`}>
        <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(img.id);
            }}
            className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-all group cursor-pointer border border-white/10 backdrop-blur-md"
            title={img.isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
            <Heart className={`w-4 h-4 transition-transform group-hover:scale-110 ${img.isFavorite ? 'fill-red-500 text-red-500' : 'text-white'}`} />
        </button>

        {onTogglePin && (
            <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTogglePin(img.id, !img.isPinned);
                }}
                className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-all group cursor-pointer border border-white/10 backdrop-blur-md"
                title={img.isPinned ? "Unpin" : "Pin to top"}
            >
                <Pin className={`w-4 h-4 transition-transform group-hover:scale-110 ${img.isPinned ? 'fill-sage-400 text-sage-400' : 'text-white'}`} />
            </button>
        )}
    </div>
);

// Extracted Component to prevent re-renders
const ImageContainer = ({
    img,
    position,
    scale,
    isDraggingCanvas,
    imagePaddingClassName = 'p-6',
    objectPosition = 'center'
}: {
    img: AIImage,
    position: { x: number, y: number },
    scale: number,
    isDraggingCanvas: boolean,
    imagePaddingClassName?: string,
    objectPosition?: React.CSSProperties['objectPosition']
}) => (
    <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        {/* Image Transform */}
        <div
            className={`w-full h-full flex items-center justify-center ${imagePaddingClassName} box-border`}
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transition: isDraggingCanvas ? 'none' : 'transform 0.1s ease-out' }}
        >
            <SmartImage
                src={img.url}
                alt={img.filename}
                className="w-full h-full"
                imgClassName="w-full h-full object-contain shadow-2xl"
                draggable={false}
                objectFit="contain"
                style={{ objectFit: 'contain', objectPosition }}
            />
        </div>
    </div>
);

export const CompareModal: React.FC<CompareModalProps> = ({
    imageA,
    imageB,
    onClose,
    onToggleFavorite,
    onTogglePin
}) => {
    // View State
    const [mode, setMode] = useState<CompareMode>('split');
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [sliderPos, setSliderPos] = useState(50);
    const [diffMode, setDiffMode] = useState<DiffMode>('diff');
    const [isOverlayHover, setIsOverlayHover] = useState(false);
    const [mediaFrame, setMediaFrame] = useState<MediaFrame>({
        left: CANVAS_PADDING_PX,
        top: CANVAS_PADDING_PX,
        width: 0,
        height: 0
    });
    const [canvasSize, setCanvasSize] = useState<CanvasSize>({
        width: 0,
        height: 0
    });

    const [panelWidth, setPanelWidth] = useState(400); // Widened for diff view
    const [isPanelOpen, setIsPanelOpen] = useState(true);

    // Interaction Refs
    const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
    const [isDraggingSlider, setIsDraggingSlider] = useState(false);

    const dragStartRef = useRef({ x: 0, y: 0 });
    const sliderRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const activeMediaFrame = clampFrameToCanvas(
        getZoomedFrame(mediaFrame, canvasSize, position, scale),
        canvasSize
    );
    const activeMediaFrameRef = useRef(activeMediaFrame);

    useEffect(() => {
        activeMediaFrameRef.current = activeMediaFrame;
    }, [activeMediaFrame]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateMediaFrame = () => {
            const rect = container.getBoundingClientRect();
            const nextCanvasSize = {
                width: rect.width,
                height: rect.height
            };
            const availableWidth = Math.max(0, rect.width - CANVAS_PADDING_PX * 2);
            const availableHeight = Math.max(0, rect.height - CANVAS_PADDING_PX * 2);
            const nextFrame = getUnionFrame(
                getFittedRect(imageA.width, imageA.height, availableWidth, availableHeight),
                getFittedRect(imageB.width, imageB.height, availableWidth, availableHeight)
            );

            setCanvasSize(prev => (
                Math.abs(prev.width - nextCanvasSize.width) < 0.5 &&
                Math.abs(prev.height - nextCanvasSize.height) < 0.5
            ) ? prev : nextCanvasSize);
            setMediaFrame(prev => framesAreEqual(prev, nextFrame) ? prev : nextFrame);
        };

        updateMediaFrame();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateMediaFrame);
            return () => window.removeEventListener('resize', updateMediaFrame);
        }

        const observer = new ResizeObserver(updateMediaFrame);
        observer.observe(container);
        return () => observer.disconnect();
    }, [imageA.width, imageA.height, imageB.width, imageB.height]);

    useEffect(() => {
        if (mode !== 'overlay') setIsOverlayHover(false);
    }, [mode]);

    // --- Zoom/Pan Handlers ---
    const resetZoom = useCallback(() => {
        setScale(COMPARE_MIN_SCALE);
        setPosition(CENTER_ANCHOR);
    }, []);

    const applyZoom = useCallback((targetScale: number, anchor: Point = CENTER_ANCHOR) => {
        const nextView = getZoomTransform({
            currentPosition: position,
            currentScale: scale,
            targetScale,
            minScale: COMPARE_MIN_SCALE,
            maxScale: COMPARE_MAX_SCALE,
            anchor
        });

        setScale(nextView.scale);
        setPosition(nextView.position);
    }, [position, scale]);

    const getAnchorForEvent = useCallback((e: React.MouseEvent | React.WheelEvent): Point => {
        if (!containerRef.current) {
            return CENTER_ANCHOR;
        }

        const containerRect = containerRef.current.getBoundingClientRect();
        const viewportRect = getCompareViewportRect(containerRect, e.clientX, mode);

        return getAnchorPoint({ x: e.clientX, y: e.clientY }, viewportRect);
    }, [mode]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        applyZoom(scale + e.deltaY * -0.001, getAnchorForEvent(e));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (scale > COMPARE_MIN_SCALE && !isDraggingSlider) {
            e.preventDefault();
            setIsDraggingCanvas(true);
            dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDraggingCanvas && scale > COMPARE_MIN_SCALE) {
            e.preventDefault();
            setPosition({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
            });
        }

        if (isDraggingSlider && containerRef.current) {
            e.preventDefault();
            const rect = containerRef.current.getBoundingClientRect();
            const frame = activeMediaFrameRef.current;
            const travelLeft = frame.width > 0 ? frame.left - SLIDER_EDGE_TRAVEL_PX : 0;
            const travelWidth = frame.width > 0 ? frame.width + SLIDER_EDGE_TRAVEL_PX * 2 : rect.width;
            const x = Math.max(travelLeft, Math.min(e.clientX - rect.left, travelLeft + travelWidth));
            setSliderPos(travelWidth > 0 ? ((x - travelLeft) / travelWidth) * 100 : 50);
        }

        if (mode === 'overlay' && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const frame = activeMediaFrameRef.current;
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const isInsideFrame = (
                frame.width > 0 &&
                frame.height > 0 &&
                x >= frame.left &&
                x <= frame.left + frame.width &&
                y >= frame.top &&
                y <= frame.top + frame.height
            );
            setIsOverlayHover(isInsideFrame);
        }
    };

    const handleMouseUp = () => {
        setIsDraggingCanvas(false);
        setIsDraggingSlider(false);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (scale > COMPARE_MIN_SCALE) {
            resetZoom();
        } else {
            applyZoom(2, getAnchorForEvent(e));
        }
    };

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

    const commonImageProps = { position, scale, isDraggingCanvas };
    const sliderTravelLeft = activeMediaFrame.left - SLIDER_EDGE_TRAVEL_PX;
    const sliderTravelWidth = activeMediaFrame.width + SLIDER_EDGE_TRAVEL_PX * 2;
    const sliderTravelX = sliderTravelLeft + (sliderTravelWidth * sliderPos) / 100;
    const sliderVisualX = Math.max(activeMediaFrame.left, Math.min(sliderTravelX, activeMediaFrame.left + activeMediaFrame.width));
    const activeMediaFrameStyle: React.CSSProperties = {
        left: activeMediaFrame.left,
        top: activeMediaFrame.top,
        width: activeMediaFrame.width,
        height: activeMediaFrame.height
    };
    const sliderHandleStyle: React.CSSProperties = {
        left: sliderVisualX,
        top: activeMediaFrame.top,
        height: activeMediaFrame.height,
        width: SLIDER_HIT_TARGET_WIDTH_PX
    };
    const sliderDividerTrackStyle: React.CSSProperties = {
        left: sliderTravelX - activeMediaFrame.left,
        width: SLIDER_HIT_TARGET_WIDTH_PX
    };
    const overlayHintStyle: React.CSSProperties = {
        left: activeMediaFrame.left + activeMediaFrame.width / 2,
        top: Math.max(activeMediaFrame.top + 12, activeMediaFrame.top + activeMediaFrame.height - 48),
        transform: 'translateX(-50%)'
    };
    const sliderClipPath = `polygon(${activeMediaFrame.left}px ${activeMediaFrame.top}px, ${sliderTravelX + DIAGONAL_OFFSET_PX}px ${activeMediaFrame.top}px, ${sliderTravelX - DIAGONAL_OFFSET_PX}px ${activeMediaFrame.top + activeMediaFrame.height}px, ${activeMediaFrame.left}px ${activeMediaFrame.top + activeMediaFrame.height}px)`;
    const sliderDividerClipPath = `polygon(calc(50% + ${DIAGONAL_OFFSET_PX}px - ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 0, calc(50% + ${DIAGONAL_OFFSET_PX}px + ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 0, calc(50% - ${DIAGONAL_OFFSET_PX}px + ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 100%, calc(50% - ${DIAGONAL_OFFSET_PX}px - ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 100%)`;

    return (
        <div
            className="fixed inset-0 z-[70] bg-black flex flex-col animate-in fade-in duration-200"
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
                handleMouseUp();
                setIsOverlayHover(false);
            }}
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
                        <button onClick={() => applyZoom(scale - COMPARE_BUTTON_ZOOM_STEP)} className="p-1 hover:text-white text-gray-500"><ZoomOut className="w-4 h-4" /></button>
                        <span className="text-xs font-mono text-gray-400 w-12 text-center">{Math.round(scale * 100)}%</span>
                        <button onClick={() => applyZoom(scale + COMPARE_BUTTON_ZOOM_STEP)} className="p-1 hover:text-white text-gray-500"><ZoomIn className="w-4 h-4" /></button>
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
                    onDoubleClick={handleDoubleClick}
                    onClick={e => e.stopPropagation()}
                >

                    {/* SPLIT */}
                    {mode === 'split' && (
                        <div className="absolute inset-0 p-6 flex gap-4 overflow-hidden">
                            <div className="flex-1 overflow-hidden relative">
                                <ImageContainer img={imageA} imagePaddingClassName="p-0" objectPosition="right center" {...commonImageProps} />
                                <ImageActions img={imageA} side="left" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                            <div className="flex-1 overflow-hidden relative">
                                <ImageContainer img={imageB} imagePaddingClassName="p-0" objectPosition="left center" {...commonImageProps} />
                                <ImageActions img={imageB} side="right" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                        </div>
                    )}

                    {/* SLIDER */}
                    {mode === 'slider' && (
                        <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 flex items-center justify-center">
                                <ImageContainer img={imageB} {...commonImageProps} />
                            </div>
                            <div
                                className="absolute inset-0 flex items-center justify-center bg-[#050505] shadow-[2px_0_20px_rgba(0,0,0,0.8)]"
                                style={{ clipPath: sliderClipPath }}
                            >
                                <ImageContainer img={imageA} {...commonImageProps} />
                            </div>
                            <div className="absolute z-50 pointer-events-none" style={activeMediaFrameStyle}>
                                <ImageActions img={imageA} side="left" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                                <ImageActions img={imageB} side="right" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                            <div className="absolute z-40 overflow-hidden pointer-events-none" style={activeMediaFrameStyle}>
                                <div
                                    className="absolute top-0 h-full -translate-x-1/2"
                                    style={sliderDividerTrackStyle}
                                >
                                    <div
                                        className="absolute inset-0 bg-sage-500 shadow-[0_0_18px_rgba(115,140,85,0.45),2px_0_20px_rgba(0,0,0,0.8)]"
                                        style={{ clipPath: sliderDividerClipPath }}
                                    />
                                </div>
                            </div>
                            <div
                                ref={sliderRef}
                                className="absolute -translate-x-1/2 cursor-ew-resize z-40 flex items-center justify-center group"
                                style={sliderHandleStyle}
                                onMouseDown={handleSliderMouseDown}
                            >
                                <div className="w-8 h-8 rounded-full bg-sage-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform rotate-[4deg]">
                                    <ArrowRightLeft className="w-4 h-4 text-white" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* OVERLAY */}
                    {mode === 'overlay' && (
                        <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 flex items-center justify-center">
                                <ImageContainer img={imageA} {...commonImageProps} />
                            </div>
                            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ease-out ${isOverlayHover ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                                <ImageContainer img={imageB} {...commonImageProps} />
                            </div>
                            <div className="absolute z-50 pointer-events-none" style={activeMediaFrameStyle}>
                                <ImageActions img={imageA} side="left" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                                <ImageActions img={imageB} side="right" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                            <div
                                className="absolute z-40 bg-black/80 text-white px-4 py-2 rounded-full text-xs pointer-events-none border border-white/10 backdrop-blur-md"
                                style={overlayHintStyle}
                            >
                                Hover to reveal comparison
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
                        <DiffRow label="Seed" valA={imageA.metadata.seed ?? 'Unknown'} valB={imageB.metadata.seed ?? 'Unknown'} />
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
