import * as React from 'react';
import { ChevronDown, ChevronUp, Pin } from 'lucide-react';
import { AIImage } from '../types';
import { GridItem } from './GridItem';

interface PinnedShelfProps {
    images: AIImage[];
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    // Props required for GridItem
    selectedIds: Set<string>;
    maskedKeywords: string[];
    privacyEnabled: boolean;
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    onImageClick: (e: React.MouseEvent, id: string, index: number) => void;
    onToggleSelection: (e: React.MouseEvent, id: string) => void;
    onTogglePin: (e: React.MouseEvent, id: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
    thumbnailSize: number;
    activeThumbnailUrl?: string;
}

export const PinnedShelf: React.FC<PinnedShelfProps> = ({
    images,
    isCollapsed,
    onToggleCollapse,
    selectedIds,
    maskedKeywords,
    privacyEnabled,
    setImages,
    onImageClick,
    onToggleSelection,
    onTogglePin,
    onContextMenu,
    thumbnailSize,
    activeThumbnailUrl
}) => {
    if (images.length === 0) return null;

    // Calculate layout for the "Collapsed" state (1 row)
    // We assume a simple responsive grid
    // For the collapsed state, we just set a max-height/overflow hidden

    return (
        <div className="flex flex-col border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-transparent backdrop-blur-sm z-10 shrink-0 transition-all duration-300">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 select-none cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors" onClick={onToggleCollapse}>
                <div className="flex items-center gap-2 text-sage-600 dark:text-sage-400 font-bold text-sm">
                    <Pin className="w-4 h-4 fill-current" />
                    <span>Pinned</span>
                    <span className="bg-sage-200 dark:bg-sage-900 text-sage-700 dark:text-sage-300 px-2 py-0.5 rounded-full text-xs ml-1 font-mono">
                        {images.length}
                    </span>
                </div>
                <button className="p-1 rounded-full text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                    {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                </button>
            </div>

            {/* Grid Content */}
            <div
                className={`px-6 pb-4 transition-all duration-500 ease-spring overflow-hidden ${isCollapsed ? 'overflow-y-hidden' : 'overflow-y-auto custom-scrollbar'}`}
                style={{
                    maxHeight: isCollapsed ? `${thumbnailSize + 32}px` : '60vh' // 32px for padding. ensures 1 row is visible.
                }}
            >
                <div
                    className="flex flex-wrap gap-4 w-full"
                >
                    {images.map((img, index) => {
                        const ratio = (img.width || 1) / (img.height || 1);
                        const width = thumbnailSize * ratio;

                        return (
                            <div
                                key={img.id}
                                style={{
                                    height: thumbnailSize,
                                    width: width,
                                    flexGrow: ratio, // Grow proportional to aspect ratio keeps scaling natural
                                    minWidth: thumbnailSize * 0.5,
                                    maxWidth: thumbnailSize * 3 // prevent ultra-wide
                                }}
                                className="relative"
                            >
                                <GridItem
                                    image={img}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        position: 'relative',
                                        top: 0, left: 0
                                    }}
                                    index={index} // This is the GLOBAL index 0..N because Pinned images are at the start
                                    isSelected={selectedIds.has(img.id)}
                                    selectedIds={selectedIds}
                                    maskedKeywords={maskedKeywords}
                                    privacyEnabled={privacyEnabled}
                                    setImages={setImages}
                                    onClick={onImageClick}
                                    onToggleSelection={onToggleSelection}
                                    onTogglePin={onTogglePin}
                                    onContextMenu={onContextMenu}
                                    isThumbnail={activeThumbnailUrl ? activeThumbnailUrl === img.thumbnailUrl : false}
                                />
                            </div>
                        );
                    })}
                    {/* Spacer to prevent last row from stretching too much */}
                    <div style={{ flexGrow: 100, height: 0 }} />
                </div>
                {/* Fade overlay for collapsed state if deeply overflowed */}
                {isCollapsed && images.length > 5 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-gray-50 dark:from-[#111] to-transparent pointer-events-none opacity-80" />
                )}
            </div>
        </div>
    );
};
