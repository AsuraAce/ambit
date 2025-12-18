import * as React from 'react';
import { useEffect, useRef } from 'react';
import { Copy, Trash2, FolderPlus, Folder, Pin, Wand2, Image as ImageIcon, ImageOff, EyeOff, FolderMinus } from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  isPinned?: boolean;
  enableAI?: boolean;
  activeCollectionName?: string;
  onClose: () => void;
  onCopyPrompt: () => void;
  onAddToCollection: () => void;
  onRemoveFromCollection?: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onShowInFolder: () => void;
  onRecoverMetadata?: () => void;
  onSetThumbnail?: () => void;
  onUnsetThumbnail?: () => void;
  onToggleMask?: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  isPinned,
  enableAI,
  activeCollectionName,
  onClose,
  onCopyPrompt,
  onAddToCollection,
  onRemoveFromCollection,
  onTogglePin,
  onDelete,
  onShowInFolder,
  onRecoverMetadata,
  onSetThumbnail,
  onUnsetThumbnail,
  onToggleMask
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Keep menu within viewport
  const style = {
    top: Math.min(y, window.innerHeight - 350),
    left: Math.min(x, window.innerWidth - 270), // Adjusted for wider menu
  };

  return (
    <div 
      ref={menuRef}
      style={style}
      className="fixed z-50 w-64 bg-zinc-950/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl shadow-black overflow-hidden animate-in fade-in duration-100 py-1"
    >
      <MenuItem icon={<Copy className="w-4 h-4" />} label="Copy Prompt" onClick={onCopyPrompt} />
      <MenuItem icon={<Pin className={`w-4 h-4 ${isPinned ? 'fill-current' : ''}`} />} label={isPinned ? "Unpin Image" : "Pin to Top"} onClick={onTogglePin} />
      <MenuItem icon={<FolderPlus className="w-4 h-4" />} label="Add to Collection..." onClick={onAddToCollection} />
      
      {activeCollectionName && onRemoveFromCollection && (
         <MenuItem 
            icon={<FolderMinus className="w-4 h-4 text-red-500" />} 
            label={`Remove from ${activeCollectionName}`} 
            onClick={onRemoveFromCollection} 
            className="hover:!bg-red-500/10 hover:!text-red-200"
         />
      )}
      
      {onToggleMask && (
          <MenuItem icon={<EyeOff className="w-4 h-4" />} label="Toggle Content Mask" onClick={onToggleMask} />
      )}

      {onSetThumbnail && (
          <MenuItem icon={<ImageIcon className="w-4 h-4 text-sage-400" />} label="Set as Thumbnail" onClick={onSetThumbnail} className="text-sage-200 hover:text-white" />
      )}
      
      {onUnsetThumbnail && (
          <MenuItem icon={<ImageOff className="w-4 h-4 text-gray-500" />} label="Reset Thumbnail" onClick={onUnsetThumbnail} className="text-gray-400 hover:text-white" />
      )}

      {enableAI && onRecoverMetadata && (
        <>
            <div className="h-px bg-white/10 my-1" />
            <MenuItem 
                icon={<Wand2 className="w-4 h-4 text-amethyst-400" />} 
                label="Recover Metadata (AI)" 
                onClick={onRecoverMetadata} 
                className="text-amethyst-200 hover:text-white hover:bg-amethyst-900/30"
            />
        </>
      )}

      <div className="h-px bg-white/10 my-1" />
      <MenuItem icon={<Folder className="w-4 h-4" />} label="Show in Folder" onClick={onShowInFolder} />
      <div className="h-px bg-white/10 my-1" />
      <MenuItem icon={<Trash2 className="w-4 h-4 text-red-400" />} label="Delete" onClick={onDelete} className="text-red-400 hover:bg-red-900/30" />
    </div>
  );
};

const MenuItem = ({ icon, label, onClick, className = "" }: { icon: React.ReactNode, label: string, onClick: () => void, className?: string }) => (
  <button 
    onClick={(e) => {
        e.stopPropagation();
        onClick();
    }}
    className={`w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors ${className}`}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
);