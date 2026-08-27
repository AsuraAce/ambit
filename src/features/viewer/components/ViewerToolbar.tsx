import * as React from 'react';
import { X, Share2, Heart, Pin, Trash2, PanelRightClose, PanelRightOpen, Copy, Layout, ExternalLink } from 'lucide-react';
import { getFilename } from '../../../utils/pathUtils';
import { AIImage } from '../../../types';
import { ViewerToolbarButton } from './ViewerToolbarButton';
import { ViewerToolbarFrame } from './ViewerToolbarFrame';

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
    onToggleFavorite?: () => void;
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
        <ViewerToolbarFrame
            filename={getFilename(image.filename)}
            visible={showControls}
            detail={versionsCount > 1 ? (
                    <div className="mt-2 flex items-center gap-2 rounded border border-sage-500/20 bg-sage-900/30 px-2 py-1 text-[10px] font-bold text-sage-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="m2 11 10-10 10 10" /><path d="m2 18 10-10 10 10" /><path d="m21 22-9-9-9 9" /></svg>
                        <span>Version {activeVersionIndex + 1} of {versionsCount}</span>
                    </div>
            ) : undefined}
            actions={<>
                <ViewerToolbarButton
                    label="Copy Image to Clipboard"
                    onClick={onCopy}
                >
                    <Copy className="w-5 h-5" />
                </ViewerToolbarButton>
                <ViewerToolbarButton
                    label="Open in Default App"
                    onClick={onOpenExternal}
                >
                    <ExternalLink className="w-5 h-5" />
                </ViewerToolbarButton>
                <ViewerToolbarButton
                    label={isTheaterMode ? "Exit Theater Mode (Z)" : "Enter Theater Mode (Z)"}
                    aria-pressed={isTheaterMode}
                    onClick={onToggleTheater}
                    className={isTheaterMode ? 'border-sage-500/50 text-sage-400' : ''}
                >
                    <Layout className="w-5 h-5" />
                </ViewerToolbarButton>
                <ViewerToolbarButton
                    label="Share Image"
                    onClick={onShare}
                >
                    <Share2 className="w-5 h-5" />
                </ViewerToolbarButton>
                {onToggleFavorite && (
                    <ViewerToolbarButton
                        label={image.isFavorite ? "Remove from Favorites (F)" : "Add to Favorites (F)"}
                        aria-pressed={image.isFavorite}
                        onClick={onToggleFavorite}
                    >
                        <Heart className={`w-5 h-5 ${image.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                    </ViewerToolbarButton>
                )}
                {onTogglePin && (
                    <ViewerToolbarButton
                        label={image.isPinned ? "Unpin (P)" : "Pin to Top (P)"}
                        aria-pressed={Boolean(image.isPinned)}
                        onClick={onTogglePin}
                        className={image.isPinned ? 'border-sage-500/50 text-sage-400' : ''}
                    >
                        <Pin className={`w-5 h-5 ${image.isPinned ? 'fill-current' : ''}`} />
                    </ViewerToolbarButton>
                )}
                {onDelete && (
                    <ViewerToolbarButton
                        label="Remove from Library"
                        onClick={onDelete}
                        className="hover:border-red-500/30 hover:bg-red-500/20 hover:text-red-400"
                    >
                        <Trash2 className="w-5 h-5" />
                    </ViewerToolbarButton>
                )}
                {onToggleSidebar && !isTheaterMode && (
                    <ViewerToolbarButton
                        label={isSidebarOpen ? "Hide Sidebar (I)" : "Show Sidebar (I)"}
                        aria-pressed={isSidebarOpen}
                        onClick={onToggleSidebar}
                    >
                        {isSidebarOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
                    </ViewerToolbarButton>
                )}
                <ViewerToolbarButton
                    label="Close Viewer (Esc)"
                    onClick={onClose}
                >
                    <X className="w-5 h-5" />
                </ViewerToolbarButton>
            </>}
        />
    );
};
