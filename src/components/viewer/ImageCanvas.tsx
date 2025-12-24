import * as React from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { AIImage } from '../../types';
import { SmartImage } from '../SmartImage';

interface ImageCanvasProps {
    image: AIImage;
    scale: number;
    position: { x: number, y: number };
    isDragging: boolean;
    showControls: boolean;
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onResetZoom: () => void;
    isTheaterMode: boolean;
    onToggleTheater: () => void;
    handlers: {
        onWheel: (e: React.WheelEvent) => void;
        onMouseDown: (e: React.MouseEvent) => void;
        onMouseMove: (e: React.MouseEvent) => void;
        onMouseUp: (e: React.MouseEvent) => void;
        onMouseLeave: (e: React.MouseEvent) => void;
        onDoubleClick: (e: React.MouseEvent) => void;
    };
}

export const ImageCanvas: React.FC<ImageCanvasProps> = ({
    image,
    scale,
    position,
    isDragging,
    showControls,
    onPrev,
    onNext,
    onClose,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    isTheaterMode,
    onToggleTheater,
    handlers
}) => {
    return (
        <div
            className="flex-1 relative flex flex-col h-full overflow-hidden select-none"
            onMouseMove={handlers.onMouseMove}
        >
            {/* Zoom Controls */}
            <div
                className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/80 backdrop-blur-xl rounded-full px-4 py-2 border border-white/10 pointer-events-auto transition-opacity duration-500 shadow-2xl ${showControls ? 'opacity-100' : 'opacity-0'}`}
            >
                <button onClick={onZoomOut} className="p-1.5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white" title="Zoom Out">
                    <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-sage-400 min-w-[3ch] text-center">{Math.round(scale * 100)}%</span>
                <button onClick={onZoomIn} className="p-1.5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white" title="Zoom In">
                    <ZoomIn className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <button onClick={onResetZoom} className="p-1.5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white" title="Reset View">
                    <RotateCcw className="w-4 h-4" />
                </button>
            </div>

            {/* Image Area */}
            <div
                className="flex-1 flex items-center justify-center relative group overflow-hidden cursor-grab active:cursor-grabbing"
                onClick={(e) => {
                    if (scale === 1 && e.target === e.currentTarget) {
                        isTheaterMode ? onToggleTheater() : onClose();
                    }
                }}
                onDoubleClick={handlers.onDoubleClick}
                onWheel={handlers.onWheel}
                onMouseDown={handlers.onMouseDown}
                onMouseUp={handlers.onMouseUp}
                onMouseLeave={handlers.onMouseLeave}
            >
                {/* Prev Button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onPrev(); }}
                    className={`absolute left-4 z-30 p-4 bg-black/20 hover:bg-black/40 text-white/50 hover:text-white rounded-full backdrop-blur-sm transition-all pointer-events-auto border border-white/5 hover:border-white/10 ${showControls ? 'opacity-0 group-hover:opacity-100' : 'opacity-0'}`}
                    title="Previous Image (Left Arrow)"
                >
                    <ChevronLeft className="w-6 h-6" />
                </button>

                <div
                    key={image.id}
                    style={{
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                        transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0.2, 1)'
                    }}
                >
                    <motion.div
                        key={image.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: "easeIn" } }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="flex items-center justify-center pointer-events-none"
                    >
                        <SmartImage
                            src={image.url}
                            alt={image.metadata.positivePrompt}
                            draggable={false}
                            objectFit="contain"
                            wrapperClassName="w-auto h-auto flex items-center justify-center"
                            imgClassName="max-w-full max-h-[90vh] w-auto h-auto shadow-2xl shadow-black pointer-events-none object-contain"
                        />
                    </motion.div>
                </div>

                {/* Next Button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onNext(); }}
                    className={`absolute right-4 z-30 p-4 bg-black/20 hover:bg-black/40 text-white/50 hover:text-white rounded-full backdrop-blur-sm transition-all pointer-events-auto border border-white/5 hover:border-white/10 ${showControls ? 'opacity-0 group-hover:opacity-100' : 'opacity-0'}`}
                    title="Next Image (Right Arrow)"
                >
                    <ChevronRight className="w-6 h-6" />
                </button>
            </div>
        </div>
    );
};