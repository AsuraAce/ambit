import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Search, Monitor, Moon, Sun, LayoutGrid, Clock, BarChart3, Eraser, Settings, Import, FolderPlus, Sparkles } from 'lucide-react';
import { AppSettings, ViewMode } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (mode: ViewMode) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onImport: () => void;
  onCreateCollection: () => void;
  onToggleAI: () => void;
  settings: AppSettings;
}

interface CommandOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  group: 'Navigation' | 'Actions' | 'System';
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onToggleTheme,
  onOpenSettings,
  onImport,
  onCreateCollection,
  onToggleAI,
  settings
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const options: CommandOption[] = useMemo(() => [
    { id: 'nav-grid', label: 'Go to Grid View', icon: <LayoutGrid className="w-4 h-4" />, group: 'Navigation', action: () => onNavigate('grid') },
    { id: 'nav-timeline', label: 'Go to Timeline', icon: <Clock className="w-4 h-4" />, group: 'Navigation', action: () => onNavigate('timeline') },
    { id: 'nav-stats', label: 'Go to Dashboard', icon: <BarChart3 className="w-4 h-4" />, group: 'Navigation', action: () => onNavigate('dashboard') },
    { id: 'nav-maint', label: 'Go to Maintenance', icon: <Eraser className="w-4 h-4" />, group: 'Navigation', action: () => onNavigate('maintenance') },
    
    { id: 'act-import', label: 'Import Images', icon: <Import className="w-4 h-4" />, group: 'Actions', action: onImport },
    { id: 'act-col', label: 'Create Collection', icon: <FolderPlus className="w-4 h-4" />, group: 'Actions', action: onCreateCollection },
    { id: 'act-ai', label: settings.enableAI ? 'Disable AI Features' : 'Enable AI Features', icon: <Sparkles className="w-4 h-4" />, group: 'Actions', action: onToggleAI },

    { id: 'sys-theme', label: `Switch to ${settings.theme === 'dark' ? 'Light' : 'Dark'} Mode`, icon: settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />, group: 'System', action: onToggleTheme },
    { id: 'sys-settings', label: 'Open Settings', icon: <Settings className="w-4 h-4" />, group: 'System', action: onOpenSettings },
  ], [settings.theme, settings.enableAI, onNavigate, onImport, onCreateCollection, onToggleAI, onToggleTheme, onOpenSettings]);

  const filteredOptions = useMemo(() => {
    if (!query) return options;
    return options.filter(opt => opt.label.toLowerCase().includes(query.toLowerCase()));
  }, [query, options]);

  useEffect(() => {
    if (isOpen) {
        setQuery('');
        setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!isOpen) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % filteredOptions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredOptions[selectedIndex]) {
                filteredOptions[selectedIndex].action();
                onClose();
            }
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredOptions, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="w-full max-w-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <Search className="w-5 h-5 text-gray-400 mr-3" />
            <input 
                autoFocus
                type="text"
                placeholder="Type a command..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
                className="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-500 text-base h-6"
            />
            <div className="flex gap-1">
                <kbd className="hidden sm:inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] text-gray-500 font-mono">↑↓</kbd>
                <kbd className="hidden sm:inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] text-gray-500 font-mono">Enter</kbd>
            </div>
        </div>
        
        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar p-2">
            {filteredOptions.length > 0 ? (
                <div className="space-y-1">
                    {filteredOptions.map((opt, i) => (
                        <button
                            key={opt.id}
                            onClick={() => { opt.action(); onClose(); }}
                            onMouseEnter={() => setSelectedIndex(i)}
                            className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-sm transition-colors ${
                                i === selectedIndex 
                                ? 'bg-sage-600 text-white' 
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={i === selectedIndex ? 'text-white' : 'text-gray-400'}>{opt.icon}</div>
                                <span>{opt.label}</span>
                            </div>
                            {opt.group && (
                                <span className={`text-[10px] uppercase font-bold tracking-wider ${i === selectedIndex ? 'text-sage-200' : 'text-gray-400'}`}>
                                    {opt.group}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="py-12 text-center text-gray-500">
                    No commands found.
                </div>
            )}
        </div>
      </div>
    </div>
  );
};