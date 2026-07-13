import * as React from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wand2, Palette, Bot, Hash } from 'lucide-react';
import { RecoveryStyle } from '../../../types';
import { cn } from '../../../utils/cn';

interface MetadataRecoveryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (style: RecoveryStyle) => void;
    isProcessing: boolean;
}

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

export const MetadataRecoveryModal: React.FC<MetadataRecoveryModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    isProcessing
}) => {
    const [selectedStyle, setSelectedStyle] = useState<RecoveryStyle>('generic');
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

    return (
        <AnimatePresence mode="wait">
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={!isProcessing ? onClose : undefined}
                        className="absolute inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-sm"
                    />

                    {/* Modal Container */}
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="relative w-full max-w-md bg-white dark:bg-[#0a0a0c] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                    >
                        {/* Decorative top line */}
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amethyst-500/50 to-transparent" />

                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-white/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-amethyst-500/10 border border-amethyst-500/20 flex items-center justify-center">
                                    <Wand2 className="w-4 h-4 text-amethyst-500" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                                        AI Prompt Recovery
                                    </h3>
                                    <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                        Gemini AI
                                    </p>
                                </div>
                            </div>
                            {!isProcessing && (
                                <button
                                    ref={closeButtonRef}
                                    type="button"
                                    aria-label="Close Metadata Recovery"
                                    onClick={onClose}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        {/* Content */}
                        <div className="p-6">
                            {isProcessing ? (
                                <div className="py-8 flex flex-col items-center justify-center text-center">
                                    <div className="relative w-14 h-14 mb-4">
                                        <div className="absolute inset-0 rounded-full bg-amethyst-500/20 animate-ping" />
                                        <div className="relative w-14 h-14 border-4 border-amethyst-500/30 border-t-amethyst-500 rounded-full animate-spin" />
                                    </div>
                                    <h4 className="text-gray-900 dark:text-white font-bold mb-2">Analyzing Image...</h4>
                                    <p className="text-xs text-gray-500 max-w-[250px]">
                                        AI is analyzing the visuals to generate a descriptive prompt.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                                        Select a target style for the generated prompt.
                                    </p>

                                    <div className="space-y-2 mb-6">
                                        {options.map(opt => (
                                            <button
                                                key={opt.id}
                                                onClick={() => setSelectedStyle(opt.id)}
                                                className={cn(
                                                    "w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 group",
                                                    selectedStyle === opt.id
                                                        ? 'bg-amethyst-50 dark:bg-amethyst-900/20 border-amethyst-500 ring-1 ring-amethyst-500/50'
                                                        : 'bg-gray-50 dark:bg-white/[0.02] border-gray-200 dark:border-white/5 hover:border-amethyst-300 dark:hover:border-amethyst-500/30'
                                                )}
                                            >
                                                <div className={cn(
                                                    "mt-0.5 transition-colors",
                                                    selectedStyle === opt.id ? 'text-amethyst-600 dark:text-amethyst-400' : 'text-gray-400 group-hover:text-amethyst-500'
                                                )}>
                                                    {opt.icon}
                                                </div>
                                                <div>
                                                    <div className={cn(
                                                        "text-sm font-semibold transition-colors",
                                                        selectedStyle === opt.id ? 'text-amethyst-700 dark:text-amethyst-300' : 'text-gray-700 dark:text-gray-300'
                                                    )}>
                                                        {opt.label}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{opt.desc}</div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
                                        <button
                                            onClick={onClose}
                                            className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => onConfirm(selectedStyle)}
                                            className="px-5 py-2 bg-amethyst-600 hover:bg-amethyst-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-amethyst-500/20 flex items-center gap-2 transition-colors"
                                        >
                                            <Wand2 className="w-4 h-4" />
                                            Generate Prompt
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
