import * as React from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, BrainCircuit, Loader2, Wand2, Info, Palette, Bot, Hash } from 'lucide-react';
import { APP_NAME } from '../../../constants/app';
import { RecoveryStyle, AIImage } from '../../../types';

interface MetadataRecoveryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (style: RecoveryStyle) => void;
    isProcessing: boolean;
}

export const MetadataRecoveryModal: React.FC<MetadataRecoveryModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    isProcessing
}) => {
    const [selectedStyle, setSelectedStyle] = useState<RecoveryStyle>('generic');

    if (!isOpen) return null;

    const options: { id: RecoveryStyle; label: string; desc: string; icon: React.ReactNode }[] = [
        {
            id: 'generic',
            label: 'Descriptive (General)',
            desc: 'Detailed natural language description suitable for most models.',
            icon: <Wand2 className="w-5 h-5" />
        },
        {
            id: 'midjourney',
            label: 'Midjourney Style',
            desc: 'Optimized for MJ v6 with --params and artistic focus.',
            icon: <Palette className="w-5 h-5" />
        },
        {
            id: 'sdxl',
            label: 'Stable Diffusion XL',
            desc: 'Standard SDXL prompting with quality boosters and style refs.',
            icon: <Bot className="w-5 h-5" />
        },
        {
            id: 'danbooru',
            label: 'Anime Tags (Danbooru)',
            desc: 'Comma-separated tags focusing on character features.',
            icon: <Hash className="w-5 h-5" />
        }
    ];

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300 ease-spring">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl p-6 transform scale-100 animate-in zoom-in-95 duration-300 ease-spring">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Wand2 className="w-5 h-5 text-amethyst-500" /> AI Prompt Recovery
                    </h3>
                    {!isProcessing && (
                        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {isProcessing ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 border-4 border-amethyst-500/30 border-t-amethyst-500 rounded-full animate-spin mb-4" />
                        <h4 className="text-gray-900 dark:text-white font-bold mb-2">Analyzing Image...</h4>
                        <p className="text-sm text-gray-500">{APP_NAME} AI is analyzing the visuals to reconstruct the prompt.</p>
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-gray-500 mb-4">
                            Select a target style, and AI will analyze the image to generate a new positive prompt for you.
                        </p>

                        <div className="space-y-3 mb-6">
                            {options.map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setSelectedStyle(opt.id)}
                                    className={`w-full text-left p-3 rounded-lg border transition-all flex items-start gap-3 ${selectedStyle === opt.id
                                        ? 'bg-amethyst-50 dark:bg-amethyst-900/20 border-amethyst-500 ring-1 ring-amethyst-500'
                                        : 'bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-800 hover:border-amethyst-300'
                                        }`}
                                >
                                    <div className={`mt-0.5 ${selectedStyle === opt.id ? 'text-amethyst-600 dark:text-amethyst-400' : 'text-gray-400'}`}>
                                        {opt.icon}
                                    </div>
                                    <div>
                                        <div className={`text-sm font-bold ${selectedStyle === opt.id ? 'text-amethyst-700 dark:text-amethyst-300' : 'text-gray-700 dark:text-gray-300'}`}>
                                            {opt.label}
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">{opt.desc}</div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => onConfirm(selectedStyle)}
                                className="px-6 py-2 bg-amethyst-600 hover:bg-amethyst-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-amethyst-500/20 flex items-center gap-2"
                            >
                                <Wand2 className="w-4 h-4" /> Run Analysis
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
