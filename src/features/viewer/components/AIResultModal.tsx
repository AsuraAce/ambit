import * as React from 'react';
import { X, Wand2, Shuffle, Copy, Check, Sparkles, LayoutPanelLeft, Lightbulb, ChevronLeft, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../../utils/cn';

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
    const [copiedAll, setCopiedAll] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState(0);

    // Reset tab when modal opens with new content
    React.useEffect(() => {
        if (isOpen) setActiveTab(0);
    }, [isOpen, content]);

    if (!isOpen || !content) return null;

    const handleCopyAll = () => {
        if (Array.isArray(content)) {
            const allText = content.join('\n\n');
            onCopy(allText);
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 2000);
        }
    };

    // Parse analysis content
    const analysisContent = type === 'analysis' ? (content as string) : '';
    const analysisParts = analysisContent.split('### Applied Example');
    const analysisText = analysisParts[0]?.trim() || '';
    const masteredPrompt = analysisParts[1]?.trim() || '';

    const variations = type === 'variations' ? (content as string[]) : [];

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
                        onClick={onClose}
                        className="absolute inset-0 bg-black/50 dark:bg-black/80 backdrop-blur-sm"
                    />

                    {/* Modal Container */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className={cn(
                            "relative w-full bg-white dark:bg-[#0a0a0c] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden",
                            "max-w-2xl"
                        )}
                    >
                        {/* Decorative top line */}
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amethyst-500/50 to-transparent" />

                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-white/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-amethyst-500/10 border border-amethyst-500/20 flex items-center justify-center">
                                    {type === 'analysis' ? (
                                        <Lightbulb className="w-4 h-4 text-amethyst-500" />
                                    ) : (
                                        <Shuffle className="w-4 h-4 text-amethyst-500" />
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                                        {type === 'analysis' ? 'Prompt Analysis' : 'Creative Variations'}
                                    </h3>
                                    <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                        Gemini AI
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {type === 'variations' && (
                                    <button
                                        onClick={handleCopyAll}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-amethyst-500 dark:text-gray-400 hover:bg-amethyst-500/5 transition-all"
                                    >
                                        {copiedAll ? <Check className="w-3.5 h-3.5" /> : <LayoutPanelLeft className="w-3.5 h-3.5" />}
                                        {copiedAll ? 'Copied' : 'Copy All'}
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {type === 'analysis' ? (
                                /* ANALYSIS VIEW */
                                <div className="p-6">
                                    {/* Analysis Tips */}
                                    <div className="mb-6">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Sparkles className="w-4 h-4 text-amethyst-500" />
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Suggested Improvements</h4>
                                        </div>
                                        <div className="bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/5 p-5">
                                            <div className="prose prose-sm dark:prose-invert max-w-none text-gray-600 dark:text-gray-300 leading-relaxed">
                                                <ReactMarkdown
                                                    components={{
                                                        h3: () => null,
                                                        p: ({ node, ...props }) => <p {...props} className="mb-3 last:mb-0 text-sm" />,
                                                        strong: ({ node, ...props }) => <strong {...props} className="text-gray-800 dark:text-white font-semibold" />,
                                                        em: ({ node, ...props }) => <em {...props} className="text-amethyst-600 dark:text-amethyst-400 not-italic font-medium" />
                                                    }}
                                                >
                                                    {analysisText}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Mastered Prompt */}
                                    {masteredPrompt && (
                                        <div>
                                            <div className="flex items-center gap-2 mb-4">
                                                <Wand2 className="w-4 h-4 text-amethyst-500" />
                                                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Applied Example</h4>
                                            </div>
                                            <MasteredPromptCard prompt={masteredPrompt} onCopy={onCopy} />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* VARIATIONS VIEW - Tabbed Interface */
                                <div className="flex flex-col h-full">
                                    {/* Tabs */}
                                    <div className="flex items-center justify-center gap-2 p-4 border-b border-gray-100 dark:border-white/5 bg-gray-50/30 dark:bg-white/[0.01]">
                                        {variations.map((_, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setActiveTab(i)}
                                                className={cn(
                                                    "px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200",
                                                    activeTab === i
                                                        ? "bg-amethyst-500 text-white shadow-lg shadow-amethyst-500/20"
                                                        : "bg-white dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:text-amethyst-500 border border-gray-200 dark:border-white/10 hover:border-amethyst-300"
                                                )}
                                            >
                                                Variation {i + 1}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Active Variation Content */}
                                    <div className="flex-1 p-6">
                                        <VariationDisplay
                                            text={variations[activeTab]}
                                            index={activeTab}
                                            onCopy={onCopy}
                                            onPrev={() => setActiveTab(Math.max(0, activeTab - 1))}
                                            onNext={() => setActiveTab(Math.min(variations.length - 1, activeTab + 1))}
                                            hasPrev={activeTab > 0}
                                            hasNext={activeTab < variations.length - 1}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-3 bg-gray-50/50 dark:bg-white/[0.02] border-t border-gray-100 dark:border-white/5 flex items-center justify-between shrink-0">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                {type === 'analysis' ? 'Semantic Analysis' : `Viewing ${activeTab + 1} of ${variations.length}`}
                            </span>
                            <button
                                onClick={onClose}
                                className="text-xs font-semibold text-amethyst-500 hover:text-amethyst-400 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

/* Mastered Prompt Card Component */
const MasteredPromptCard: React.FC<{ prompt: string; onCopy: (text: string) => void }> = ({ prompt, onCopy }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
        onCopy(prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative bg-gradient-to-br from-amethyst-500/5 to-purple-500/5 dark:from-amethyst-500/10 dark:to-purple-500/5 rounded-xl border border-amethyst-200 dark:border-amethyst-500/20 p-5 group">
            <div className="absolute top-3 right-3">
                <button
                    onClick={handleCopy}
                    className={cn(
                        "p-2 rounded-lg transition-all duration-200 border text-xs font-medium flex items-center gap-1.5",
                        copied
                            ? "bg-amethyst-500 border-amethyst-500 text-white"
                            : "bg-white dark:bg-black/40 border-gray-200 dark:border-white/10 text-gray-500 hover:text-amethyst-500 hover:border-amethyst-300"
                    )}
                >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed font-mono pr-20 selection:bg-amethyst-500/30">
                {prompt}
            </p>
        </div>
    );
};

/* Variation Display Component (for tabbed view) */
interface VariationDisplayProps {
    text: string;
    index: number;
    onCopy: (text: string) => void;
    onPrev: () => void;
    onNext: () => void;
    hasPrev: boolean;
    hasNext: boolean;
}

const VariationDisplay: React.FC<VariationDisplayProps> = ({ text, index, onCopy, onPrev, onNext, hasPrev, hasNext }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
        onCopy(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="h-full flex flex-col">
            {/* Prompt Card */}
            <div className="flex-1 relative bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/5 p-6">
                {/* Navigation Arrows */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2">
                    <button
                        onClick={onPrev}
                        disabled={!hasPrev}
                        className={cn(
                            "w-8 h-8 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 flex items-center justify-center shadow-lg transition-all",
                            hasPrev ? "hover:border-amethyst-300 hover:text-amethyst-500" : "opacity-30 cursor-not-allowed"
                        )}
                    >
                        <ChevronLeft className="w-4 h-4 text-gray-500" />
                    </button>
                </div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2">
                    <button
                        onClick={onNext}
                        disabled={!hasNext}
                        className={cn(
                            "w-8 h-8 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 flex items-center justify-center shadow-lg transition-all",
                            hasNext ? "hover:border-amethyst-300 hover:text-amethyst-500" : "opacity-30 cursor-not-allowed"
                        )}
                    >
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed font-mono selection:bg-amethyst-500/30 px-4">
                    {text}
                </p>
            </div>

            {/* Copy Button */}
            <div className="flex justify-center mt-4">
                <button
                    onClick={handleCopy}
                    className={cn(
                        "px-4 py-2 rounded-lg transition-all duration-200 border text-sm font-semibold flex items-center gap-2",
                        copied
                            ? "bg-amethyst-500 border-amethyst-500 text-white shadow-lg shadow-amethyst-500/20"
                            : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:text-amethyst-500 hover:border-amethyst-300"
                    )}
                >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy This Variation'}
                </button>
            </div>
        </div>
    );
};
