
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, Archive, ArchiveRestore, Play, Download, ImageOff, ChevronRight, Pin, Settings } from 'lucide-react';
import { SortOption } from '../../../types';

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

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const style = {
    top: Math.min(y, window.innerHeight - 350),
    left: Math.min(x, window.innerWidth - 220),
  };

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
      style={style}
      className="fixed z-[100] w-52 bg-zinc-950/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl shadow-black overflow-visible animate-in fade-in duration-100 py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem icon={<Play className="w-4 h-4 text-white" />} label="Play Slideshow" onClick={onPlaySlideshow} />
      <MenuItem icon={<Download className="w-4 h-4" />} label="Export to ZIP..." onClick={onExport} />

      <div className="h-px bg-white/10 my-1" />

      <MenuItem icon={<Pencil className="w-4 h-4" />} label="Rename" onClick={onRename} />
      {onEditCollection && (
        <MenuItem icon={<Settings className="w-4 h-4" />} label="Edit Filters" onClick={onEditCollection} />
      )}

      {/* Color Tags */}
      <div className="px-3 py-2 flex items-center justify-between">
        {colors.map(c => (
          <button
            key={String(c.id)}
            onClick={() => { onColorChange(c.id); onClose(); }}
            className={`w-4 h-4 rounded-full transition-transform hover:scale-125 ${c.class} ${currentColor === c.id ? 'ring-2 ring-white' : ''}`}
            title={c.id || "None"}
          />
        ))}
      </div>

      <div className="h-px bg-white/10 my-1" />

      {hasCustomThumbnail && (
        <MenuItem icon={<ImageOff className="w-4 h-4" />} label="Reset Thumbnail" onClick={onResetThumbnail} />
      )}

      {hasCustomThumbnail && <div className="h-px bg-white/10 my-1" />}

      <MenuItem
        icon={<Pin className={`w-4 h-4 ${isPinned ? 'fill-current text-white' : ''}`} />}
        label={isPinned ? "Unpin Collection" : "Pin Collection"}
        onClick={onTogglePin}
      />

      <MenuItem
        icon={isArchived ? <ArchiveRestore className="w-4 h-4 text-yellow-400" /> : <Archive className="w-4 h-4" />}
        label={isArchived ? "Unarchive" : "Archive"}
        onClick={onToggleArchive}
        className={isArchived ? "text-yellow-100" : ""}
      />
      <MenuItem icon={<Trash2 className="w-4 h-4 text-red-400" />} label="Delete" onClick={onDelete} className="text-red-400 hover:bg-red-900/30" />
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
      {icon && <div className="w-4 flex justify-center">{icon}</div>}
      {label}
    </div>
    {rightElement}
  </button>
);

