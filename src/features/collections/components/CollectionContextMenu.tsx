
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, Archive, ArchiveRestore, Play, Download, ImageOff, ChevronRight, Pin, Settings } from 'lucide-react';
import { SortOption } from '../../../types';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface CollectionContextMenuProps {
  x: number;
  y: number;
  collectionId: string;
  isArchived?: boolean;
  isPinned?: boolean;
  hasCustomThumbnail?: boolean;
  currentColor?: string;
  onClose: () => void;
  onRename: () => void;
  onToggleArchive: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onPlaySlideshow: () => void;
  onExport: () => void;
  onResetThumbnail: () => void;
  onColorChange: (color: string | undefined) => void;
  onEditCollection?: () => void;
}

const ActionButton = ({ icon, onClick, label, pressed, className = "" }: { icon: React.ReactNode, onClick: () => void, label: string, pressed?: boolean, className?: string }) => (
  <TooltipButton
    label={label}
    content={label}
    aria-pressed={pressed}
    onClick={onClick}
    className={`p-2 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white ${className}`}
  >
    {icon}
  </TooltipButton>
);

export const CollectionContextMenu: React.FC<CollectionContextMenuProps> = ({
  x,
  y,
  isArchived,
  isPinned,
  hasCustomThumbnail,
  currentColor,
  onClose,
  onRename,
  onToggleArchive,
  onTogglePin,
  onDelete,
  onPlaySlideshow,
  onExport,
  onResetThumbnail,
  onColorChange,
  onEditCollection,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep menu within viewport logic
  const MENU_WIDTH = 240;
  const [menuPos, setMenuPos] = useState({ top: y, left: x });

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  useEffect(() => {
    const top = Math.min(y, window.innerHeight - 300);
    const left = Math.min(x, window.innerWidth - MENU_WIDTH);
    setMenuPos({ top, left });
  }, [x, y]);

  const colors = [
    { id: 'red', class: 'bg-red-500' },
    { id: 'orange', class: 'bg-orange-500' },
    { id: 'green', class: 'bg-green-500' },
    { id: 'blue', class: 'bg-blue-500' },
    { id: 'purple', class: 'bg-purple-500' },
    { id: undefined, class: 'bg-gray-700 border border-gray-500' }, // None
  ];

  return (
    <div
      ref={menuRef}
      style={{ top: menuPos.top, left: menuPos.left }}
      className="fixed z-[100] w-60 bg-zinc-950/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl shadow-black overflow-visible animate-in fade-in zoom-in-95 duration-100 py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Quick Actions Bar */}
      <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5 border-b border-white/5 mb-1">
        <div className="flex gap-0.5">
          <ActionButton
            icon={<Play className="w-4 h-4 text-gray-400" />}
            onClick={onPlaySlideshow}
            label="Play Slideshow"
          />
          <ActionButton
            icon={<Pin className={`w-4 h-4 ${isPinned ? 'fill-sage-400 text-white' : 'text-gray-400'}`} />}
            onClick={onTogglePin}
            label={isPinned ? "Unpin collection" : "Pin collection"}
            pressed={Boolean(isPinned)}
          />
          <ActionButton
            icon={isArchived ? <ArchiveRestore className="w-4 h-4 text-yellow-400" /> : <Archive className="w-4 h-4 text-gray-400" />}
            onClick={onToggleArchive}
            label={isArchived ? "Unarchive" : "Archive"}
            pressed={Boolean(isArchived)}
          />
        </div>
        <ActionButton
          icon={<Trash2 className="w-4 h-4 text-gray-400" />}
          onClick={onDelete}
          label="Delete Collection"
          className="hover:!bg-red-500/20 hover:!text-red-400"
        />
      </div>

      {/* Main Menu Groups */}

      {/* Management */}
      <MenuItem icon={<Pencil className="w-4 h-4 text-gray-400" />} label="Rename" onClick={onRename} />
      {onEditCollection && (
        <MenuItem icon={<Settings className="w-4 h-4 text-gray-400" />} label="Edit Filters" onClick={onEditCollection} />
      )}

      {/* Color Tags */}
      <div className="px-3 py-2 flex items-center justify-between">
        {colors.map(c => (
          <button
            key={String(c.id)}
            type="button"
            aria-label={c.id ? `Set collection color to ${c.id}` : "Clear collection color"}
            aria-pressed={currentColor === c.id}
            onClick={() => { onColorChange(c.id); onClose(); }}
            className={`w-4 h-4 rounded-full transition-transform hover:scale-125 ${c.class} ${currentColor === c.id ? 'ring-2 ring-white' : ''}`}
          />
        ))}
      </div>

      <div className="h-px bg-white/5 my-1" />

      {/* Data & Assets */}
      <MenuItem icon={<Download className="w-4 h-4 text-gray-400" />} label="Export to ZIP..." onClick={onExport} />

      {hasCustomThumbnail && (
        <>
          <div className="h-px bg-white/5 my-1" />
          <MenuItem icon={<ImageOff className="w-4 h-4 text-gray-400" />} label="Reset Thumbnail" onClick={onResetThumbnail} />
        </>
      )}

    </div>
  );
};

const MenuItem = ({
  icon,
  label,
  onClick,
  className = "",
  rightElement
}: {
  icon?: React.ReactNode,
  label: string,
  onClick: () => void,
  className?: string,
  rightElement?: React.ReactNode
}) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={`w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/10 hover:text-white flex items-center justify-between transition-colors ${className}`}
  >
    <div className="flex items-center gap-2">
      {icon}
      <span className="truncate">{label}</span>
    </div>
    {rightElement}
  </button>
);
