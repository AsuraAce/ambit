

import * as React from 'react';
import { useState } from 'react';
import { Heart, CheckCircle, GripHorizontal, Pin, EyeOff, Unlink, Image as ImageIcon } from 'lucide-react';
import { AIImage } from '../types';
import { SmartImage } from './SmartImage';

interface ImageCardProps {
  image: AIImage;
  isSelected: boolean;
  isMasked?: boolean;
  isThumbnail?: boolean; // New Prop
  onClick: (e: React.MouseEvent) => void;
  onToggleSelection: (e: React.MouseEvent) => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onTogglePin?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onImageError?: () => void;
}

export const ImageCard: React.FC<ImageCardProps> = ({
  image,
  isSelected,
  isMasked = false,
  isThumbnail = false,
  onClick,
  onToggleSelection,
  onToggleFavorite,
  onTogglePin,
  onContextMenu,
  onDragStart,
  onImageError
}) => {
  const [isRevealed, setIsRevealed] = useState(false);

  const shouldBlur = isMasked && !isRevealed;
  const isMissing = !!image.isMissing;

  // Auto-blur when mouse leaves the card area for privacy
  const handleMouseLeave = () => {
    if (isRevealed) {
      setIsRevealed(false);
    }
  };

  return (
    <div
      className={`group relative w-full h-full rounded-2xl overflow-hidden bg-white dark:bg-slate-800 border transition-all duration-500 ease-spring select-none
        ${isSelected
          ? 'border-sage-500 ring-2 ring-sage-500/50 z-10 shadow-[0_0_20px_rgba(140,163,107,0.3)] scale-[1.02]'
          : isMissing
            ? 'border-red-300 dark:border-red-900/50 opacity-80'
            : 'border-gray-200 dark:border-white/5 hover:border-sage-300 dark:hover:border-white/20 hover:shadow-2xl hover:-translate-y-1 hover:scale-[1.02]'
        }
        ${isMissing ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
      `}
      onClick={!isMissing ? onClick : undefined}
      onContextMenu={onContextMenu}
      onMouseLeave={handleMouseLeave}
      draggable={!isMissing && !!onDragStart}
      onDragStart={(e) => onDragStart && onDragStart(e, image.id)}
    >
      <SmartImage
        src={image.thumbnailUrl}
        alt={image.filename}
        onImageError={onImageError}
        loading="eager"
        className={`w-full h-full transition-all duration-700 ease-spring 
            ${shouldBlur ? 'blur-xl scale-110 opacity-50' : 'group-hover:scale-110'} 
            ${isMissing ? 'grayscale opacity-50' : 'opacity-90 group-hover:opacity-100'}
        `}
      />

      {/* Missing File Overlay */}
      {isMissing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-gray-100/10 dark:bg-black/40 backdrop-grayscale">
          <div className="p-3 bg-red-100 dark:bg-red-900/50 rounded-full mb-2 backdrop-blur-sm border border-red-200 dark:border-red-500/30">
            <Unlink className="w-6 h-6 text-red-500 dark:text-red-400" />
          </div>
          <span className="text-[10px] font-bold text-white bg-black/50 px-2 py-1 rounded">File Not Found</span>
        </div>
      )}

      {/* Content Masking Overlay */}
      {shouldBlur && !isMissing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-gray-100/50 dark:bg-slate-950/20 backdrop-blur-sm animate-in fade-in duration-300">
          <EyeOff className="w-8 h-8 text-sage-500 dark:text-sage-400 mb-2 drop-shadow-md" />
          <span className="text-xs font-bold text-sage-600 dark:text-sage-200 uppercase tracking-wider drop-shadow-md">Hidden Content</span>
          <button
            onClick={(e) => { e.stopPropagation(); setIsRevealed(true); }}
            className="mt-2 px-4 py-1.5 bg-black/50 hover:bg-black/80 text-white text-xs font-bold rounded-full border border-white/20 transition-colors shadow-lg backdrop-blur-md cursor-pointer"
          >
            Reveal
          </button>
        </div>
      )}

      {/* Pin Indicator */}
      {image.isPinned && !isMissing && (
        <div className="absolute top-2 right-2 z-20 p-1.5 bg-sage-500 text-white rounded-full shadow-lg shadow-sage-500/50 animate-in zoom-in duration-300">
          <Pin className="w-3 h-3 fill-current" />
        </div>
      )}

      {/* Collection Thumbnail Indicator */}
      {isThumbnail && !isMissing && (
        <div className="absolute bottom-2 left-2 z-20 p-1.5 bg-amethyst-500/80 backdrop-blur-md text-white rounded-full shadow-lg border border-white/20 animate-in zoom-in duration-300 transition-opacity group-hover:opacity-0" title="Collection Thumbnail">
          <ImageIcon className="w-3 h-3" />
        </div>
      )}

      {/* Selection Checkbox */}
      <div
        className={`absolute top-2 left-2 z-20 transition-all duration-300 ease-spring cursor-pointer p-1 ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100'}`}
        onClick={onToggleSelection}
      >
        <div className={`w-5 h-5 rounded-full border flex items-center justify-center shadow-sm backdrop-blur-sm transition-colors ${isSelected ? 'bg-sage-500 border-sage-500' : 'bg-black/40 border-white/30 hover:bg-black/60'}`}>
          {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
        </div>
      </div>

      {/* Hover Overlay - Only show if not blurred and not missing */}
      {!shouldBlur && !isMissing && (
        <div className={`absolute inset-0 bg-gradient-to-t from-gray-900/90 via-transparent to-transparent transition-opacity duration-300 ease-spring p-4 flex flex-col justify-end ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <div className="flex justify-between items-end translate-y-4 group-hover:translate-y-0 transition-transform duration-500 ease-spring">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate drop-shadow-md font-sans">
                {typeof image.metadata.model === 'string' ? image.metadata.model : (image.metadata.model as any)?.name || 'Model'}
              </div>
              <div className="text-[10px] text-gray-300 font-mono">{image.width}x{image.height}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Manual Hide Button (Only if it was masked originally) */}
              {isMasked && (
                <button
                  className="p-1.5 hover:bg-white/20 rounded-full transition-colors text-white cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setIsRevealed(false); }}
                  title="Hide content"
                >
                  <EyeOff className="w-4 h-4" />
                </button>
              )}

              {onTogglePin && (
                <button
                  className={`p-1.5 rounded-full transition-colors cursor-pointer ${image.isPinned ? 'text-sage-400 bg-white/10' : 'text-white hover:bg-white/20'}`}
                  onClick={(e) => { e.stopPropagation(); onTogglePin(e); }}
                  title={image.isPinned ? "Unpin" : "Pin to Top"}
                >
                  <Pin className={`w-4 h-4 ${image.isPinned ? 'fill-current' : ''}`} />
                </button>
              )}
              <button
                className="p-1.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
                onClick={onToggleFavorite}
              >
                <Heart className={`w-4 h-4 ${image.isFavorite ? 'fill-red-500 text-red-500' : 'text-white'}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drag Handle Indicator (Subtle) */}
      {!shouldBlur && !isMissing && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto cursor-grab active:cursor-grabbing">
          {!image.isPinned && <GripHorizontal className="w-4 h-4 text-white/50 drop-shadow-md" />}
        </div>
      )}
    </div>
  );
};
