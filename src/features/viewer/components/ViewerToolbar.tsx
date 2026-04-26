import * as React from 'react';
import { X, Share2, Heart, Trash2, PanelRightClose, PanelRightOpen, Copy, Layout, ExternalLink } from 'lucide-react';
import { getFilename } from '../../../utils/pathUtils';
import { AIImage } from '../../../types';

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
    onDelete,
    onToggleSidebar,
    onClose
}) => {
    return (
        <div className={`absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black via-black/50 to-transparent pointer-events-none transition-opacity duration-500 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
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
                <button
                    onClick={onCopy}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                    title="Copy Image to Clipboard"
                >
                    <Copy className="w-5 h-5" />
                </button>
                <button
                    onClick={onOpenExternal}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                    title="Open in Default App"
                >
                    <ExternalLink className="w-5 h-5" />
                </button>
                <button
                    onClick={onToggleTheater}
                    className={`p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full transition-all backdrop-blur-md shadow-lg ${isTheaterMode ? 'text-sage-400 border-sage-500/50' : 'text-white/50 hover:text-white'}`}
                    title="Theater Mode (Z)"
                >
                    <Layout className="w-5 h-5" />
                </button>
                <button
                    onClick={onShare}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                    title="Share"
                >
                    <Share2 className="w-5 h-5" />
                </button>
                <button
                    onClick={onToggleFavorite}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                    title={`Favorite (F)${image.isFavorite ? ' - Remove' : ''}`}
                >
                    <Heart className={`w-5 h-5 ${image.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                </button>
                {onDelete && (
                    <button
                        onClick={onDelete}
                        className="p-2.5 bg-black/50 hover:bg-red-500/20 border border-white/5 hover:border-red-500/30 rounded-full text-white/50 hover:text-red-400 transition-all backdrop-blur-md shadow-lg"
                        title="Remove from Library"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                )}
                {onToggleSidebar && !isTheaterMode && (
                    <button
                        onClick={onToggleSidebar}
                        className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                        title={isSidebarOpen ? "Hide Sidebar (I)" : "Show Sidebar (I)"}
                    >
                        {isSidebarOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
                    </button>
                )}
                <button
                    onClick={onClose}
                    className="p-2.5 bg-black/50 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md shadow-lg"
                    title="Close (Esc)"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};
