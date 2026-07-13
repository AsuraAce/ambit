import * as React from 'react';
import { X, Share2, Heart, Pin, Trash2, PanelRightClose, PanelRightOpen, Copy, Layout, ExternalLink } from 'lucide-react';
import { getFilename } from '../../../utils/pathUtils';
import { AIImage } from '../../../types';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface ViewerToolbarProps {
    image: AIImage;
    versionsCount: number;
    activeVersionIndex: number;
    showControls: boolean;
    isTheaterMode: boolean;
    isSidebarOpen: boolean;
    onCopy: () => void;
    onOpenExternal: () => void;
    onToggleTheater: () => void;
    onShare: () => void;
    onToggleFavorite: () => void;
    onTogglePin?: () => void;
    onDelete?: () => void;
    onToggleSidebar?: () => void;
    onClose: () => void;
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
    image,
    versionsCount,
    activeVersionIndex,
    showControls,
    isTheaterMode,
    isSidebarOpen,
    onCopy,
    onOpenExternal,
    onToggleTheater,
    onShare,
    onToggleFavorite,
    onTogglePin,
    onDelete,
    onToggleSidebar,
    onClose
}) => {
    return (
        <div className={`absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black via-black/50 to-transparent pointer-events-none transition-opacity duration-500 focus-within:opacity-100 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex flex-col items-start pointer-events-auto">
                <div className="text-gray-300 text-sm font-mono bg-black/50 px-3 py-1.5 rounded-lg border border-white/10 backdrop-blur-md shadow-xl">
                    {getFilename(image.filename)}
                </div>
                {versionsCount > 1 && (
                    <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-sage-400 bg-sage-900/30 px-2 py-1 rounded border border-sage-500/20">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="m2 11 10-10 10 10" /><path d="m2 18 10-10 10 10" /><path d="m21 22-9-9-9 9" /></svg>
                        <span>Version {activeVersionIndex + 1} of {versionsCount}</span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3 pointer-events-auto">
                <TooltipButton
                    label="Copy Image to Clipboard"
                    content="Copy Image to Clipboard"
                    onClick={onCopy}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                >
                    <Copy className="w-5 h-5" />
                </TooltipButton>
                <TooltipButton
                    label="Open in Default App"
                    content="Open in Default App"
                    onClick={onOpenExternal}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                >
                    <ExternalLink className="w-5 h-5" />
                </TooltipButton>
                <TooltipButton
                    label={isTheaterMode ? "Exit Theater Mode (Z)" : "Enter Theater Mode (Z)"}
                    content={isTheaterMode ? "Exit Theater Mode (Z)" : "Enter Theater Mode (Z)"}
                    aria-pressed={isTheaterMode}
                    onClick={onToggleTheater}
                    className={`p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full transition-all backdrop-blur-md shadow-lg ${isTheaterMode ? 'text-sage-400 border-sage-500/50' : 'text-white/50 hover:text-white'}`}
                >
                    <Layout className="w-5 h-5" />
                </TooltipButton>
                <TooltipButton
                    label="Share Image"
                    content="Share Image"
                    onClick={onShare}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                >
                    <Share2 className="w-5 h-5" />
                </TooltipButton>
                <TooltipButton
                    label={image.isFavorite ? "Remove from Favorites (F)" : "Add to Favorites (F)"}
                    content={image.isFavorite ? "Remove from Favorites (F)" : "Add to Favorites (F)"}
                    aria-pressed={image.isFavorite}
                    onClick={onToggleFavorite}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                >
                    <Heart className={`w-5 h-5 ${image.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                </TooltipButton>
                {onTogglePin && (
                    <TooltipButton
                        label={image.isPinned ? "Unpin (P)" : "Pin to Top (P)"}
                        content={image.isPinned ? "Unpin (P)" : "Pin to Top (P)"}
                        aria-pressed={Boolean(image.isPinned)}
                        onClick={onTogglePin}
                        className={`p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full transition-all backdrop-blur-md shadow-lg ${image.isPinned ? 'text-sage-400 border-sage-500/50' : 'text-white/50 hover:text-white'}`}
                    >
                        <Pin className={`w-5 h-5 ${image.isPinned ? 'fill-current' : ''}`} />
                    </TooltipButton>
                )}
                {onDelete && (
                    <TooltipButton
                        label="Remove from Library"
                        content="Remove from Library"
                        onClick={onDelete}
                        className="p-2.5 bg-black/50 hover:bg-red-500/20 border border-white/5 hover:border-red-500/30 rounded-full text-white/50 hover:text-red-400 transition-all backdrop-blur-md shadow-lg"
                    >
                        <Trash2 className="w-5 h-5" />
                    </TooltipButton>
                )}
                {onToggleSidebar && !isTheaterMode && (
                    <TooltipButton
                        label={isSidebarOpen ? "Hide Sidebar (I)" : "Show Sidebar (I)"}
                        content={isSidebarOpen ? "Hide Sidebar (I)" : "Show Sidebar (I)"}
                        aria-pressed={isSidebarOpen}
                        onClick={onToggleSidebar}
                        className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                    >
                        {isSidebarOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
                    </TooltipButton>
                )}
                <button
                    type="button"
                    aria-label="Close Viewer (Esc)"
                    onClick={onClose}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};
