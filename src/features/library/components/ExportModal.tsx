import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { X, Share, Archive, FolderOpen, CheckCircle2 } from 'lucide-react';

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    count: number;
    onConfirm: (filename: string, folder: string) => void;
    isExporting: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({
    isOpen,
    onClose,
    count,
    onConfirm,
    isExporting
}) => {
    const [filename, setFilename] = useState(`ambit_export_${new Date().toISOString().slice(0, 10)}`);
    const [folder, setFolder] = useState<string | null>(null);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        if (!isOpen) return;

        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();

        return () => {
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [isOpen]);

    const handlePickFolder = async () => {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
            directory: true,
            multiple: false,
            title: "Select Export Destination"
        });
        if (selected) setFolder(selected as string);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-md"
                    onClick={onClose}
                >
                    <div className="absolute inset-0" />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 30 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className="relative w-full max-w-sm bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-white/10 rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header Accent */}
                        <div className="h-1.5 w-full bg-gradient-to-r from-sage-500 to-emerald-600" />

                        <div className="p-8">
                            <div className="flex flex-col items-center text-center mb-8">
                                <div className="p-4 rounded-2xl bg-sage-50 dark:bg-sage-500/10 text-sage-600 dark:text-sage-400 mb-6 shadow-xl">
                                    <Archive className="w-8 h-8" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">Export Selection</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                                    Export <strong>{count}</strong> images and metadata into a single ZIP archive.
                                </p>
                            </div>

                            <div className="space-y-6">
                                {/* Filename Input */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 ml-1">Archive Name</label>
                                    <div className="relative group">
                                        <input
                                            type="text"
                                            value={filename}
                                            onChange={(e) => setFilename(e.target.value)}
                                            placeholder="Enter filename..."
                                            className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:ring-2 ring-sage-500/20 focus:border-sage-500/50 outline-none transition-all"
                                            disabled={isExporting}
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">.zip</div>
                                    </div>
                                </div>

                                {/* Folder Picker */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 ml-1">Destination</label>
                                    <button
                                        onClick={handlePickFolder}
                                        disabled={isExporting}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${folder
                                                ? 'bg-sage-50/50 dark:bg-sage-500/5 border-sage-500/30 text-sage-700 dark:text-sage-300'
                                                : 'bg-gray-50 dark:bg-black/20 border-gray-200 dark:border-white/5 text-gray-500 dark:text-gray-400 hover:border-sage-500/30'
                                            }`}
                                    >
                                        <FolderOpen className={`w-4 h-4 shrink-0 ${folder ? 'text-sage-500' : 'text-gray-400'}`} />
                                        <span className="text-xs truncate flex-1">
                                            {folder || "Choose destination folder..."}
                                        </span>
                                        {folder && <CheckCircle2 className="w-3.5 h-3.5 text-sage-500 shrink-0" />}
                                    </button>
                                </div>
                            </div>

                            <div className="mt-10 flex flex-col gap-3">
                                <button
                                    onClick={() => folder && onConfirm(filename, folder)}
                                    disabled={!filename.trim() || !folder || isExporting}
                                    className="w-full py-4 px-6 bg-gradient-to-br from-sage-500 to-emerald-600 hover:shadow-[0_8px_20px_-4px_rgba(16,185,129,0.4)] text-white rounded-2xl text-sm font-bold shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isExporting ? (
                                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                                            <Share className="w-4 h-4" />
                                        </motion.div>
                                    ) : <Share className="w-4 h-4" />}
                                    {isExporting ? 'Exporting...' : 'Begin Export'}
                                </button>
                                <button
                                    onClick={onClose}
                                    disabled={isExporting}
                                    className="w-full py-3 px-6 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors rounded-2xl"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>

                        {/* Close Button */}
                        {!isExporting && (
                            <button
                                ref={closeButtonRef}
                                type="button"
                                aria-label="Close Export"
                                onClick={onClose}
                                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
