import * as React from 'react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Edit3, RefreshCw } from 'lucide-react';

interface RenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedCount: number;
    onRename: (pattern: string, startNum: number) => void;
}

export const RenameModal: React.FC<RenameModalProps> = ({ isOpen, onClose, selectedCount, onRename }) => {
    const [pattern, setPattern] = useState('image_####');
    const [startNum, setStartNum] = useState(1);
    const [preview, setPreview] = useState('');

    useEffect(() => {
        if (isOpen) {
            // Reset or keep defaults
            setPattern('image_####');
            setStartNum(1);
        }
    }, [isOpen]);

    useEffect(() => {
        const example = pattern.replace(/#+/g, (match) => {
            return String(startNum).padStart(match.length, '0');
        });
        setPreview(example);
    }, [pattern, startNum]);



    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
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
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Edit3 className="w-5 h-5 text-accent-500" /> Batch Rename
                            </h3>
                            <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Filename Pattern</label>
                                <input
                                    type="text"
                                    value={pattern}
                                    onChange={(e) => setPattern(e.target.value)}
                                    className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-900 dark:text-white focus:border-accent-500 outline-none"
                                    placeholder="e.g. vacation_####"
                                />
                                <p className="text-xs text-gray-500 mt-1">Use # for numbering (e.g. ## becomes 01)</p>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Start Numbering At</label>
                                <input
                                    type="number"
                                    value={startNum}
                                    onChange={(e) => setStartNum(Number(e.target.value))}
                                    min="0"
                                    className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-900 dark:text-white focus:border-accent-500 outline-none"
                                />
                            </div>

                            <div className="p-4 bg-gray-50 dark:bg-gray-950 rounded border border-gray-200 dark:border-gray-800">
                                <div className="text-xs text-gray-500 uppercase mb-2">Preview (1 of {selectedCount})</div>
                                <div className="font-mono text-accent-600 dark:text-accent-400 font-medium">{preview}.png</div>
                            </div>
                        </div>

                        <div className="mt-8 flex justify-end gap-3">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    onRename(pattern, startNum);
                                    onClose();
                                }}
                                className="px-6 py-2 bg-accent-600 hover:bg-accent-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-accent-500/20 flex items-center gap-2"
                            >
                                <RefreshCw className="w-4 h-4" /> Rename All
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
