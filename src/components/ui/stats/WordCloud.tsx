
import * as React from 'react';
import { motion } from 'framer-motion';

interface WordCloudProps {
    keywords: { text: string; value: number }[];
    onWordClick: (word: string) => void;
    totalImages: number;
}

export const WordCloud: React.FC<WordCloudProps & { isLoading?: boolean }> = ({ keywords, onWordClick, totalImages, isLoading }) => {
    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2 h-full">
                <div className="w-10 h-10 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">Analyzing Library</p>
            </div>
        );
    }

    if (keywords.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 h-full opacity-60">
                <p className="text-xs uppercase tracking-wider font-medium">No keywords found</p>
            </div>
        );
    }

    // Normalize values for font size
    const max = Math.max(...keywords.map(k => k.value));
    const min = Math.min(...keywords.map(k => k.value));

    const getFontSize = (value: number) => {
        if (max === min) return '1rem';
        const size = 0.85 + ((value - min) / (max - min)) * 1.5;
        return `${size}rem`;
    };

    const getOpacity = (value: number) => {
        if (max === min) return 1;
        return 0.5 + ((value - min) / (max - min)) * 0.5;
    };

    return (
        <div className="h-full flex flex-col overflow-hidden relative">
            <div className="flex-1 overflow-y-auto custom-scrollbar no-scrollbar flex flex-wrap items-start justify-center gap-x-4 gap-y-2 p-6 content-start">
                {keywords.map((word, i) => (
                    <motion.button
                        key={word.text}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: getOpacity(word.value) }}
                        whileHover={{ scale: 1.1, opacity: 1 }}
                        onClick={() => onWordClick(word.text)}
                        className={`cursor-pointer transition-colors hover:text-white font-medium whitespace-nowrap focus:outline-none ${['text-indigo-400', 'text-purple-400', 'text-pink-400', 'text-sage-400', 'text-blue-400', 'text-emerald-400'][i % 6]
                            }`}
                        style={{ fontSize: getFontSize(word.value) }}
                        title={`${word.value} occurrences`}
                    >
                        {word.text}
                    </motion.button>
                ))}
            </div>

            <div className="flex-shrink-0 pt-3 mt-2 border-t border-black/10 dark:border-white/5 flex items-center justify-between text-[9px] text-gray-500 uppercase tracking-widest font-bold">
                <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <span>Deep Analysis</span>
                </div>
                <div>{totalImages.toLocaleString()} Generations</div>
            </div>
        </div>
    );
};
