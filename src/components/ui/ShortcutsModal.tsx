import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, Command, Search, ChevronDown, ChevronRight, Monitor, Hash, Puzzle, Sliders, Calendar } from 'lucide-react';
import { APP_NAME } from '../../constants/app';

interface ShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'shortcuts' | 'search';
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose, initialTab = 'shortcuts' }) => {
    const [activeTab, setActiveTab] = useState<'shortcuts' | 'search'>(initialTab);
    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();

        return () => {
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [isOpen]);

    // Load expanded state from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('ambit_shortcuts_expanded');
        if (saved) {
            try {
                setExpandedCategories(JSON.parse(saved));
            } catch (e) {
                // Fail silently, use defaults
                setExpandedCategories({ 'General': true });
            }
        } else {
            // Default: General is open
            setExpandedCategories({ 'General': true });
        }
    }, []);

    // Save expanded state to localStorage
    useEffect(() => {
        if (Object.keys(expandedCategories).length > 0) {
            localStorage.setItem('ambit_shortcuts_expanded', JSON.stringify(expandedCategories));
        }
    }, [expandedCategories]);

    const toggleCategory = (title: string) => {
        setExpandedCategories(prev => ({
            ...prev,
            [title]: !prev[title]
        }));
    };

    // Sync internal state if prop changes while open
    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
        }
    }, [isOpen, initialTab]);

    if (!isOpen) return null;

    const shortcutCategories = [
        {
            title: 'General',
            items: [
                { key: '?', desc: 'Show this help dialog' },
                { key: 'Ctrl/Cmd + K', desc: 'Open Command Palette' },
                { key: 'Ctrl/Cmd + F', desc: 'Focus search bar' },
                { key: 'Ctrl/Cmd + ,', desc: 'Open Settings' },
                { key: 'Ctrl/Cmd + O', desc: 'Import images' },
                { key: 'Shift + H', desc: 'Toggle Global Privacy Mode' },
                { key: 'Esc', desc: 'Clear selection / Close dialog' },
                { key: 'F11', desc: 'Toggle fullscreen (desktop app)' },
            ]
        },
        {
            title: 'Library Navigation',
            items: [
                { key: 'Arrow Keys', desc: 'Navigate grid' },
                { key: 'Enter', desc: 'Open details / Save search' },
                { key: 'Space', desc: 'Open Quick View for selection' },
            ]
        },
        {
            title: 'Library Actions',
            items: [
                { key: 'F', desc: 'Toggle selected Favorites' },
                { key: 'P', desc: 'Toggle selected Pins' },
                { key: 'M', desc: 'Toggle selected Content Masks' },
                { key: 'C', desc: 'Add selection to Collection' },
                { key: 'Del', desc: 'Remove selected from Library' },
            ]
        },
        {
            title: 'Selection',
            items: [
                { key: 'Ctrl/Cmd + A', desc: 'Select all visible' },
                { key: 'Ctrl/Cmd + Click', desc: 'Toggle selection' },
                { key: 'Shift + Click', desc: 'Range selection' },
            ]
        },
        {
            title: 'Viewer',
            items: [
                { key: 'Left / Right', desc: 'Previous / Next image' },
                { key: 'Space', desc: 'Close Quick View' },
                { key: 'F', desc: 'Toggle Favorite' },
                { key: 'P', desc: 'Toggle Pin' },
                { key: 'I', desc: 'Toggle metadata sidebar' },
                { key: 'Z', desc: 'Toggle Theater Mode' },
                { key: 'Del', desc: 'Remove viewed image from Library' },
                { key: 'Esc', desc: 'Exit Theater Mode / Close Viewer' },
            ]
        },
        {
            title: 'Slideshow',
            items: [
                { key: 'Left / Right', desc: 'Previous / Next image' },
                { key: 'Space', desc: 'Play / Pause' },
                { key: 'I', desc: 'Toggle image information' },
                { key: 'Esc', desc: 'Close slideshow' },
            ]
        }
    ];

    const searchOperators = [
        // Content Search
        { op: 'sunset', desc: 'Search positive prompt (default)', icon: <Search className="w-3 h-3" /> },
        { op: 'forest OR ocean', desc: 'Match either prompt term', icon: <Search className="w-3 h-3" /> },
        { op: 'neg:blur', desc: 'Search negative prompt', icon: <Hash className="w-3 h-3" /> },
        { op: 'file:portrait', desc: 'Search filename/path', icon: <Hash className="w-3 h-3" /> },
        { op: 'all:anime', desc: 'Search all metadata (legacy)', icon: <Hash className="w-3 h-3" /> },

        // Model & Resources
        { op: 'model:sdxl', desc: 'Filter by model', icon: <Monitor className="w-3 h-3" /> },
        { op: 'lora:detail', desc: 'Filter by LoRA', icon: <Puzzle className="w-3 h-3" /> },
        { op: 'tool:invoke', desc: 'Filter by generator', icon: <Command className="w-3 h-3" /> },
        { op: 'sampler:euler', desc: 'Filter by sampler', icon: <Sliders className="w-3 h-3" /> },

        // Parameters
        { op: 'steps:>30', desc: 'Steps greater than 30', icon: <Hash className="w-3 h-3" /> },
        { op: 'cfg:<7', desc: 'CFG less than 7', icon: <Sliders className="w-3 h-3" /> },
        { op: 'seed:12345', desc: 'Filter by seed', icon: <Hash className="w-3 h-3" /> },

        // Dates
        { op: 'date:2025', desc: 'All images from 2025', icon: <Calendar className="w-3 h-3" /> },
        { op: 'date:2026-04', desc: 'All images from Apr 2026', icon: <Calendar className="w-3 h-3" /> },
        { op: 'after:2026-04', desc: 'From Apr 2026 onward', icon: <Calendar className="w-3 h-3" /> },
        { op: 'before:2025', desc: 'Through 2025', icon: <Calendar className="w-3 h-3" /> },

        // Dimensions
        { op: 'w:>1024', desc: 'Width filter', icon: <Monitor className="w-3 h-3" /> },
        { op: 'h:<768', desc: 'Height filter', icon: <Monitor className="w-3 h-3" /> },
        { op: 'upscaled:true', desc: 'Show upscaled only', icon: <Monitor className="w-3 h-3" /> },
    ];

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 ease-spring"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg bg-white dark:bg-[#09090b] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transform scale-100 animate-in zoom-in-95 duration-300 ease-spring"
                onClick={e => e.stopPropagation()}
            >

                {/* Header */}
                <div className="p-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-black/20">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white pl-2">{APP_NAME} Help & Guide</h2>
                    <button ref={closeButtonRef} type="button" aria-label="Close Keyboard Shortcuts" onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 dark:border-white/5">
                    <button
                        onClick={() => setActiveTab('shortcuts')}
                        className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors relative ${activeTab === 'shortcuts' ? 'text-sage-600 dark:text-sage-400 bg-white dark:bg-[#09090b]' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                    >
                        <Keyboard className="w-4 h-4" /> Keyboard Shortcuts
                        {activeTab === 'shortcuts' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sage-500" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('search')}
                        className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors relative ${activeTab === 'search' ? 'text-sage-600 dark:text-sage-400 bg-white dark:bg-[#09090b]' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                    >
                        <Search className="w-4 h-4" /> Search Syntax
                        {activeTab === 'search' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sage-500" />}
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto custom-scrollbar">

                    {activeTab === 'shortcuts' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                            {shortcutCategories.map((cat, ci) => {
                                const isExpanded = expandedCategories[cat.title] ?? false;
                                return (
                                    <div key={ci} className="border border-transparent">
                                        <button
                                            type="button"
                                            aria-expanded={isExpanded}
                                            onClick={() => toggleCategory(cat.title)}
                                            className="w-full flex items-center justify-between py-2 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded transition-colors group"
                                        >
                                            <span className="flex items-center gap-2">
                                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                                {cat.title}
                                            </span>
                                            <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">Click to toggle</span>
                                        </button>

                                        {isExpanded && (
                                            <div className="grid grid-cols-1 gap-1 mt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                                {cat.items.map((s, i) => (
                                                    <div key={i} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group/item">
                                                        <span className="text-sm text-gray-600 dark:text-gray-300">{s.desc}</span>
                                                        <kbd className="px-2 py-1 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-white/10 rounded text-[10px] font-mono font-bold text-gray-500 dark:text-gray-400 shadow-sm min-w-[2rem] text-center group-hover/item:text-gray-900 dark:group-hover/item:text-white group-hover/item:border-gray-300 dark:group-hover/item:border-white/20 transition-colors">
                                                            {s.key}
                                                        </kbd>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <div className="text-center text-[10px] text-gray-400 pt-4 border-t border-gray-100 dark:border-white/5 uppercase tracking-tight">
                                Tip: Right-click images for context-specific actions.
                            </div>
                        </div>
                    )}

                    {activeTab === 'search' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                                    By default, search matches the <strong>positive prompt only</strong>. Spaces narrow results, while explicit OR matches alternatives. Use operators below to search other fields.
                                </p>

                                <div className="bg-gray-50 dark:bg-black/20 rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
                                    <div className="grid grid-cols-12 bg-gray-100 dark:bg-white/5 p-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                                        <div className="col-span-5 pl-2">Operator</div>
                                        <div className="col-span-7">Description</div>
                                    </div>
                                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                                        {searchOperators.map((op, i) => (
                                            <div key={i} className="grid grid-cols-12 p-2 text-sm border-b border-gray-100 dark:border-white/5 last:border-0 hover:bg-white dark:hover:bg-white/5 transition-colors">
                                                <div className="col-span-5 font-mono text-sage-600 dark:text-sage-400 pl-2 flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
                                                    {op.icon} {op.op}
                                                </div>
                                                <div className="col-span-7 text-xs text-gray-600 dark:text-gray-400">{op.desc}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Date Syntax</h4>
                                <div className="p-3 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 space-y-2">
                                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-12 sm:gap-2">
                                        <span className="sm:col-span-6 font-bold text-sage-600 dark:text-sage-400 font-mono break-all">date:2025</span>
                                        <span className="sm:col-span-6 text-gray-600 dark:text-gray-300">Images from a year</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-12 sm:gap-2">
                                        <span className="sm:col-span-6 font-bold text-sage-600 dark:text-sage-400 font-mono break-all">date:2026-04</span>
                                        <span className="sm:col-span-6 text-gray-600 dark:text-gray-300">Images from a month</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-12 sm:gap-2">
                                        <span className="sm:col-span-6 font-bold text-sage-600 dark:text-sage-400 font-mono break-all">date:2026-04-15</span>
                                        <span className="sm:col-span-6 text-gray-600 dark:text-gray-300">Images from one day</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-12 sm:gap-2">
                                        <span className="sm:col-span-6 font-bold text-sage-600 dark:text-sage-400 font-mono break-all">date:2026-04..2026-06</span>
                                        <span className="sm:col-span-6 text-gray-600 dark:text-gray-300">Inclusive date range</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-12 sm:gap-2">
                                        <span className="sm:col-span-6 font-bold text-sage-600 dark:text-sage-400 font-mono break-all">after:2026-04</span>
                                        <span className="sm:col-span-6 text-gray-600 dark:text-gray-300">From Apr 2026 onward</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-12 sm:gap-2">
                                        <span className="sm:col-span-6 font-bold text-sage-600 dark:text-sage-400 font-mono break-all">before:2025</span>
                                        <span className="sm:col-span-6 text-gray-600 dark:text-gray-300">Through 2025</span>
                                    </div>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-tight pt-1 border-t border-gray-200 dark:border-white/10">
                                        Use ISO dates to avoid country-specific ambiguity. Dates use local calendar days and combine with other terms using AND.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Advanced Syntax</h4>
                                <div className="grid grid-cols-1 gap-2">
                                    <div className="p-3 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-bold text-sage-600 dark:text-sage-400 font-mono">-tag</span>
                                            <span className="text-xs text-gray-600 dark:text-gray-300">Exclude terms with "-" or "!"</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-sage-600 dark:text-sage-400 font-mono">"phrase"</span>
                                            <span className="text-xs text-gray-600 dark:text-gray-300">Exact match with quotes</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs font-bold text-sage-600 dark:text-sage-400 font-mono">OR</span>
                                            <span className="text-xs text-gray-600 dark:text-gray-300">Match either adjacent prompt term</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                                <h4 className="text-xs font-bold text-gray-800 dark:text-gray-300 mb-1">Example Query</h4>
                                <div className="font-mono text-xs bg-white dark:bg-black/40 p-2 rounded border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 mb-2">
                                    forest OR "city skyline" model:flux
                                </div>
                                <p className="text-[10px] text-gray-600 dark:text-gray-400 uppercase tracking-tight">
                                    Finds Flux images whose positive prompt mentions forest or city skyline.
                                </p>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
