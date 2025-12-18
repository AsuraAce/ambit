import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { X, Share, Archive } from 'lucide-react';

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    count: number;
    onConfirm: (filename: string) => void;
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



    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl p-6"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Archive className="w-5 h-5 text-sage-500" /> Export Selection
                            </h3>
                            {!isExporting && (
                                <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-white">
                                    <X className="w-5 h-5" />
                                </button>
                            )}
                        </div>

                        <div className="space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                You are about to export <strong>{count}</strong> images and their metadata to a ZIP archive.
                            </p>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Filename</label>
                                <div className="flex items-center">
                                    <input
                                        type="text"
                                        value={filename}
                                        onChange={(e) => setFilename(e.target.value)}
                                        className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-l-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-sage-500 outline-none"
                                        disabled={isExporting}
                                    />
                                    <div className="bg-gray-200 dark:bg-gray-800 border border-l-0 border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-500 rounded-r-lg">
                                        .zip
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-8 flex justify-end gap-3">
                            <button
                                onClick={onClose}
                                disabled={isExporting}
                                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => onConfirm(filename)}
                                disabled={!filename.trim() || isExporting}
                                className="px-6 py-2 bg-sage-600 hover:bg-sage-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-sage-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
                            >
                                {isExporting ? (
                                    <>Processing...</>
                                ) : (
                                    <>
                                        <Share className="w-4 h-4" /> Export
                                    </>
                                )
                                }
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};