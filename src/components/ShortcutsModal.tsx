import * as React from 'react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, Search, Command, Hash, Sliders, Monitor, Puzzle } from 'lucide-react';

interface ShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'shortcuts' | 'search';
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose, initialTab = 'shortcuts' }) => {
    const [activeTab, setActiveTab] = useState<'shortcuts' | 'search'>(initialTab);

    // Sync internal state if prop changes while open
    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
        }
    }, [isOpen, initialTab]);

    if (!isOpen) return null;

    const shortcuts = [
        { key: '?', desc: 'Show this help dialog' },
        { key: 'Ctrl + K', desc: 'Open Command Palette' },
        { key: 'Space', desc: 'Toggle Quick View' },
        { key: 'Esc', desc: 'Clear selection / Close view' },
        { key: 'F', desc: 'Toggle Favorite (selected)' },
        { key: 'P', desc: 'Toggle Pin (selected)' },
        { key: 'M', desc: 'Toggle content mask for selected' },
        { key: 'C', desc: 'Add selected to Collection' },
        { key: 'F2', desc: 'Batch Rename' },
        { key: 'Shift + H', desc: 'Toggle Global Privacy Mode' },
        { key: 'Ctrl + A', desc: 'Select all visible images' },
        { key: 'Ctrl + F', desc: 'Focus search bar' },
        { key: 'Del', desc: 'Delete selected images' },
        { key: 'Arrow Keys', desc: 'Navigate grid' },
        { key: 'Enter', desc: 'Open details / Save search' },
        { key: 'Z', desc: 'Toggle Zen Mode (in Viewer)' },
        { key: 'Ctrl + Click', desc: 'Toggle single selection' },
        { key: 'Shift + Click', desc: 'Range selection' },
    ];

    const searchOperators = [
        { op: 'steps:20', desc: 'Exact step count match', icon: <Hash className="w-3 h-3" /> },
        { op: 'steps:>30', desc: 'Steps greater than 30', icon: <Hash className="w-3 h-3" /> },
        { op: 'cfg:<7', desc: 'CFG Scale less than 7', icon: <Sliders className="w-3 h-3" /> },
        { op: 'model:sdxl', desc: 'Filter by model name (partial match)', icon: <Monitor className="w-3 h-3" /> },
        { op: 'lora:detail', desc: 'Filter by LoRA name (partial match)', icon: <Puzzle className="w-3 h-3" /> },
        { op: 'tool:comfy', desc: 'Filter by generator tool', icon: <Command className="w-3 h-3" /> },
        { op: 'seed:1234', desc: 'Find specific seed', icon: <Hash className="w-3 h-3" /> },
    ];

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 ease-spring"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg bg-white dark:bg-[#09090b] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transform scale-100 animate-in zoom-in-95 duration-300 ease-spring"
                onClick={e => e.stopPropagation()}
            >

                {/* Header */}
                <div className="p-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-black/20">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white pl-2">Help & Documentation</h2>
                    <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
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
                            <div className="grid grid-cols-1 gap-2">
                                {shortcuts.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                                        <span className="text-sm text-gray-600 dark:text-gray-300">{s.desc}</span>
                                        <kbd className="px-2 py-1 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-white/10 rounded text-xs font-mono font-bold text-gray-700 dark:text-gray-300 shadow-sm min-w-[2rem] text-center group-hover:border-gray-300 dark:group-hover:border-white/20">
                                            {s.key}
                                        </kbd>
                                    </div>
                                ))}
                            </div>
                            <div className="text-center text-xs text-gray-400 pt-4 border-t border-gray-100 dark:border-white/5">
                                Tip: Right-click images for context-specific actions like Pinning or Collections.
                            </div>
                        </div>
                    )}

                    {activeTab === 'search' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                                    You can combine plain text searches with advanced operators to filter your library precisely.
                                </p>

                                <div className="bg-gray-50 dark:bg-black/20 rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
                                    <div className="grid grid-cols-12 bg-gray-100 dark:bg-white/5 p-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                                        <div className="col-span-5 pl-2">Operator</div>
                                        <div className="col-span-7">Description</div>
                                    </div>
                                    {searchOperators.map((op, i) => (
                                        <div key={i} className="grid grid-cols-12 p-2 text-sm border-b border-gray-100 dark:border-white/5 last:border-0 hover:bg-white dark:hover:bg-white/5 transition-colors">
                                            <div className="col-span-5 font-mono text-sage-600 dark:text-sage-400 pl-2 flex items-center gap-2">
                                                {op.icon} {op.op}
                                            </div>
                                            <div className="col-span-7 text-gray-600 dark:text-gray-400">{op.desc}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="p-4 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                                <h4 className="text-sm font-bold text-gray-800 dark:text-gray-300 mb-1">Example Query</h4>
                                <div className="font-mono text-xs bg-white dark:bg-black/40 p-2 rounded border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 mb-2">
                                    cyberpunk steps:&gt;30 model:flux lora:detail
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400">
                                    Finds images with "cyberpunk" in the prompt, generated with more than 30 steps using a Flux model, and using a "detail" LoRA.
                                </p>
                            </div>

                            <div className="text-center text-xs text-gray-400">
                                Note: Natural Language Search (AI) overrides these operators if enabled.
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};