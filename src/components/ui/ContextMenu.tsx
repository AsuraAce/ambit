import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Copy, Heart, Pin, FolderPlus, FolderMinus, Trash2, Folder,
  Wand2, Eye, EyeOff, MinusCircle, ImageIcon, ExternalLink,
  ImageOff, ChevronRight, Share2, Layout, Shield
} from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  isPinned?: boolean;
  enableAI?: boolean;
  activeCollectionName?: string;
  onClose: () => void;
  onCopyPrompt: () => void;
  onCopySeed?: () => void;
  onCopyGenerationInfo?: () => void;
  onCopyImage?: () => void;
  onCopyFilePath?: () => void;
  onOpenInDefaultApp?: () => void;
  onAddToCollection: () => void;
  onMoveToCollection?: () => void;
  onRemoveFromCollection?: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onShowInFolder: () => void;
  onRecoverMetadata?: () => void;
  onSetThumbnail?: () => void;
  onUnsetThumbnail?: () => void;
  onToggleMask?: (override?: boolean | null) => void;
  onToggleFavorite?: () => void;
  isFavorite?: boolean;
  isMasked?: boolean;
  userMasked?: boolean;
  isIntermediate?: boolean;
  onToggleIntermediate?: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  isPinned,
  enableAI,
  activeCollectionName,
  onClose,
  onCopyPrompt,
  onCopySeed,
  onCopyGenerationInfo,
  onCopyImage,
  onCopyFilePath,
  onOpenInDefaultApp,
  onAddToCollection,
  onRemoveFromCollection,
  onTogglePin,
  onDelete,
  onShowInFolder,
  onRecoverMetadata,
  onSetThumbnail,
  onUnsetThumbnail,
  onToggleMask,
  onToggleFavorite,
  onMoveToCollection,
  isFavorite,
  isMasked,
  userMasked,
  isIntermediate,
  onToggleIntermediate,
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

  // Keep menu within viewport logic
  const MENU_WIDTH = 240;
  const SUBMENU_WIDTH = 220;

  const [menuPos, setMenuPos] = useState({ top: y, left: x });
  const [side, setSide] = useState<'right' | 'left'>('right');

  useEffect(() => {
    const top = Math.min(y, window.innerHeight - 300);
    const left = Math.min(x, window.innerWidth - MENU_WIDTH);

    // Determine which side submenus should open on
    const wouldOverflowRight = left + MENU_WIDTH + SUBMENU_WIDTH > window.innerWidth;
    setSide(wouldOverflowRight ? 'left' : 'right');

    setMenuPos({ top, left });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={{ top: menuPos.top, left: menuPos.left }}
      className="fixed z-50 w-60 bg-zinc-950/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl shadow-black overflow-visible animate-in fade-in zoom-in-95 duration-100 py-1"
    >
      {/* Quick Actions Bar */}
      <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5 border-b border-white/5 mb-1">
        <div className="flex gap-0.5">
          <ActionButton
            icon={<Heart className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />}
            onClick={() => onToggleFavorite?.()}
            title={isFavorite ? "Unfavorite" : "Favorite"}
          />
          <ActionButton
            icon={<Pin className={`w-4 h-4 ${isPinned ? 'fill-sage-400 text-white' : 'text-gray-400'}`} />}
            onClick={onTogglePin}
            title={isPinned ? "Unpin" : "Pin to Top"}
          />
          <ActionButton
            icon={<Folder className="w-4 h-4 text-gray-400" />}
            onClick={onShowInFolder}
            title="Show in Folder"
          />
        </div>
        <ActionButton
          icon={<Trash2 className="w-4 h-4 text-red-400/70" />}
          onClick={onDelete}
          title="Delete Image"
          className="hover:!bg-red-500/20 hover:!text-red-400"
        />
      </div>

      {/* Main Menu Groups */}
      <SubMenu label="Copy Data" icon={<Share2 className="w-4 h-4 text-blue-400" />} side={side}>
        <MenuItem icon={<Copy className="w-4 h-4 text-gray-400" />} label="Copy Prompt" onClick={onCopyPrompt} />
        {onCopySeed && <MenuItem icon={<Copy className="w-4 h-4 text-amethyst-400" />} label="Copy Seed" onClick={onCopySeed} />}
        {onCopyGenerationInfo && <MenuItem icon={<Copy className="w-4 h-4 text-sage-400" />} label="Copy All Info" onClick={onCopyGenerationInfo} />}
        <div className="h-px bg-white/5 my-1" />
        {onCopyImage && <MenuItem icon={<ImageIcon className="w-4 h-4 text-gray-400" />} label="Copy Image" onClick={onCopyImage} />}
        {onCopyFilePath && <MenuItem icon={<Copy className="w-4 h-4 text-zinc-500" />} label="Copy File Path" onClick={onCopyFilePath} />}
      </SubMenu>

      <SubMenu label="Organize" icon={<Layout className="w-4 h-4 text-amber-400" />} side={side}>
        <MenuItem icon={<FolderPlus className="w-4 h-4 text-gray-400" />} label="Add to Collection..." onClick={onAddToCollection} />
        {onMoveToCollection && (
          <MenuItem icon={<Layout className="w-4 h-4 text-sage-400" />} label="Move to Collection..." onClick={onMoveToCollection} />
        )}
        {activeCollectionName && onRemoveFromCollection && (
          <MenuItem
            icon={<FolderMinus className="w-4 h-4 text-red-500" />}
            label="Remove from Collection"
            onClick={onRemoveFromCollection}
            className="hover:!bg-red-500/10 hover:!text-red-200"
          />
        )}
        <div className="h-px bg-white/5 my-1" />
        {onSetThumbnail && (
          <MenuItem icon={<ImageIcon className="w-4 h-4 text-sage-400" />} label="Set as Thumbnail" onClick={onSetThumbnail} />
        )}
        {onUnsetThumbnail && (
          <MenuItem icon={<ImageOff className="w-4 h-4 text-gray-500" />} label="Reset Thumbnail" onClick={onUnsetThumbnail} />
        )}
      </SubMenu>

      <SubMenu label="Privacy & AI" icon={<Shield className="w-4 h-4 text-amethyst-400" />} side={side}>
        {onToggleMask && (
          <>
            {userMasked !== undefined && (
              <MenuItem
                icon={<MinusCircle className="w-4 h-4 text-amethyst-400" />}
                label="Reset Mask to Auto"
                onClick={() => onToggleMask(null)}
              />
            )}
            {!isMasked && (
              <MenuItem icon={<EyeOff className="w-4 h-4 text-gray-400" />} label="Mask Content" onClick={() => onToggleMask(true)} />
            )}
            {isMasked && (
              <MenuItem icon={<Eye className="w-4 h-4 text-sage-400" />} label="Unmask Content" onClick={() => onToggleMask(false)} />
            )}
          </>
        )}
        {onToggleIntermediate && (
          <>
            <div className="h-px bg-white/5 my-1" />
            <MenuItem
              icon={<ImageOff className={`w-4 h-4 ${isIntermediate ? 'text-blue-400' : 'text-gray-400'}`} />}
              label={isIntermediate ? "Unmark as Intermediate" : "Mark as Intermediate"}
              onClick={onToggleIntermediate}
            />
          </>
        )}
        {enableAI && onRecoverMetadata && (
          <>
            <div className="h-px bg-white/5 my-1" />
            <MenuItem
              icon={<Wand2 className="w-4 h-4 text-amethyst-400" />}
              label="Recover Metadata (AI)"
              onClick={onRecoverMetadata}
              className="text-amethyst-200"
            />
          </>
        )}
      </SubMenu>

      <div className="h-px bg-white/5 my-1" />

      {
        onOpenInDefaultApp && (
          <MenuItem
            icon={<ExternalLink className="w-4 h-4 text-sage-400" />}
            label="Open in Default App"
            onClick={onOpenInDefaultApp}
          />
        )
      }
    </div >
  );
};

const SubMenu = ({ label, icon, children, side }: { label: string, icon: React.ReactNode, children: React.ReactNode, side: 'right' | 'left' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = window.setTimeout(() => setIsOpen(false), 150);
  };

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/10 hover:text-white flex items-center justify-between transition-colors group">
        <div className="flex items-center gap-2">
          {icon}
          <span>{label}</span>
        </div>
        <ChevronRight className={`w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-90 sm:rotate-0' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute top-0 w-56 bg-zinc-950/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl py-1 z-[60] animate-in fade-in zoom-in-95 duration-150 ${side === 'right' ? 'left-[calc(100%+4px)]' : 'right-[calc(100%+4px)]'}`}
        >
          {children}
        </div>
      )}
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

const ActionButton = ({ icon, onClick, title, className = "" }: { icon: React.ReactNode, onClick: () => void, title: string, className?: string }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title={title}
    className={`p-2 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white ${className}`}
  >
    {icon}
  </button>
);
