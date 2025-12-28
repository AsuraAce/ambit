import * as React from 'react';
import { X, Wand2, Shuffle, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AIResultModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'analysis' | 'variations';
    content: string | string[] | null;
    onCopy: (text: string) => void;
}

export const AIResultModal: React.FC<AIResultModalProps> = ({
    isOpen,
    onClose,
    type,
    content,
    onCopy
}) => {
    if (!isOpen || !content) return null;

    return (
        <div
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-white/5 shrink-0">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {type === 'analysis' ? <Wand2 className="w-4 h-4 text-amethyst-500" /> : <Shuffle className="w-4 h-4 text-amethyst-500" />}
                        {type === 'analysis' ? 'Prompt Analysis' : 'Creative Variations'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {type === 'analysis' ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            <ReactMarkdown>{content as string}</ReactMarkdown>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {(content as string[]).map((variation, i) => (
                                <div key={i} className="group relative p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 hover:border-amethyst-500/30 transition-colors">
                                    <p className="text-sm text-gray-700 dark:text-gray-300 pr-8 leading-snug">{variation}</p>
                                    <button
                                        onClick={() => onCopy(variation)}
                                        className="absolute top-2 right-2 p-1.5 rounded-md bg-white dark:bg-black/40 text-gray-400 hover:text-amethyst-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
