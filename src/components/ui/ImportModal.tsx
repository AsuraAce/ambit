import * as React from 'react';
import { useState } from 'react';
import { X, Link2, FolderOpen, FileImage, Check, Sparkles, RefreshCw, Heart, Workflow } from 'lucide-react';
import { AppSettings } from '../../types';

interface ImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings: (tab: 'invokeai' | 'a1111' | 'comfyui' | 'folders') => void;
    onImportFiles: () => void;
    settings: AppSettings;
    setSettings: (update: Partial<AppSettings> | ((prev: AppSettings) => Partial<AppSettings>)) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
    isOpen,
    onClose,
    onOpenSettings,
    onImportFiles,
    settings,
    setSettings
}) => {
    if (!isOpen) return null;

    const handleDontShowAgain = (checked: boolean) => {
        setSettings({ hideImportModal: checked });
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <FileImage className="w-5 h-5 text-sage-500" />
                        Add Images to Your Library
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Recommended: Integrations */}
                    <div className="relative">
                        <div className="absolute -top-3 left-4 px-2 py-0.5 bg-sage-500 text-white text-[10px] font-bold uppercase tracking-wider rounded">
                            Recommended
                        </div>
                        <div className="p-5 border-2 border-sage-500/30 bg-sage-500/5 dark:bg-sage-500/10 rounded-xl">
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-sage-500/10 rounded-xl">
                                    <Link2 className="w-6 h-6 text-sage-600 dark:text-sage-400" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-bold text-gray-900 dark:text-white mb-1">Set Up Integration</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                        InvokeAI • ComfyUI • A1111 / Forge
                                    </p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4 text-xs text-gray-600 dark:text-gray-300">
                                        <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-sage-500" /> Auto-sync new images</span>
                                        <span className="flex items-center gap-1.5"><Heart className="w-3.5 h-3.5 text-sage-500" /> Import favorites & boards</span>
                                        <span className="flex items-center gap-1.5"><Workflow className="w-3.5 h-3.5 text-sage-500" /> Full metadata extraction</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => { onOpenSettings('invokeai'); onClose(); }}
                                            className="px-3 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-bold transition-colors"
                                        >
                                            InvokeAI
                                        </button>
                                        <button
                                            onClick={() => { onOpenSettings('comfyui'); onClose(); }}
                                            className="px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold transition-colors"
                                        >
                                            ComfyUI
                                        </button>
                                        <button
                                            onClick={() => { onOpenSettings('a1111'); onClose(); }}
                                            className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-bold transition-colors"
                                        >
                                            A1111 / Forge
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-4">
                        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                        <span className="text-xs text-gray-400 font-medium">or</span>
                        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    </div>

                    {/* Fallback: One-Time Import */}
                    <div>
                        <h3 className="font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-gray-400" />
                            One-Time Import
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                            For images from downloaded packs, other apps, or screenshots.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { onImportFiles(); onClose(); }}
                                className="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <FileImage className="w-4 h-4" />
                                Select Files
                            </button>
                            <button
                                onClick={() => { onOpenSettings('folders'); onClose(); }}
                                className="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <FolderOpen className="w-4 h-4" />
                                Select Folder
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <div
                            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${settings.hideImportModal ? 'bg-sage-600 border-sage-600' : 'border-gray-400'}`}
                            onClick={() => handleDontShowAgain(!settings.hideImportModal)}
                        >
                            {settings.hideImportModal && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Don't show this again</span>
                    </label>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm font-medium transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
