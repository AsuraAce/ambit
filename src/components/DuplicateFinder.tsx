import * as React from 'react';
import { useState } from 'react';
import { AIImage } from '../types';
import { AlertTriangle, Check, Layers, Copy, ArrowRight, Maximize2, EyeOff, Eye } from 'lucide-react';
import { useDuplicateFinder } from '../hooks/useDuplicateFinder';
import { isImageMasked } from '../utils/maskingUtils';

// --- Sub-Component for Reveal State ---
const DuplicateItem: React.FC<{
    img: AIImage;
    groupType: 'exact' | 'version';
    isLastInGroup: boolean;
    onKeepOnly: (imgId: string) => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
}> = ({ img, groupType, isLastInGroup, onKeepOnly, privacyEnabled, maskedKeywords }) => {
    const [isRevealed, setRevealed] = useState(false);
    const isMasked = !isRevealed && isImageMasked(img, privacyEnabled, maskedKeywords);

    return (
        <div className="group relative flex flex-col min-w-[160px] w-[calc(50%-0.5rem)] flex-shrink-0" onMouseLeave={() => isRevealed && setRevealed(false)}>
            {/* Image Preview */}
            <div className="relative aspect-[2/3] bg-gray-100 dark:bg-slate-950 rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 group-hover:border-sage-500/50 transition-colors">
                <img
                    src={img.thumbnailUrl}
                    alt=""
                    className={`w-full h-full object-cover transition-all ${isMasked ? 'blur-xl scale-110' : ''}`}
                />

                {isMasked && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/50 dark:bg-slate-950/20 backdrop-blur-sm z-10">
                        <EyeOff className="w-8 h-8 text-gray-500 dark:text-gray-400 drop-shadow-md mb-2" />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setRevealed(true);
                            }}
                            className="px-3 py-1 bg-black/50 hover:bg-black/70 text-white text-[10px] font-bold uppercase tracking-wider rounded-full backdrop-blur-md transition-colors flex items-center gap-1"
                        >
                            <Eye className="w-3 h-3" /> Reveal
                        </button>
                    </div>
                )}

                {/* Resolution Badge */}
                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md text-[10px] font-mono text-white px-2 py-0.5 rounded border border-white/10 shadow-sm z-20">
                    {img.width}x{img.height}
                </div>

                {/* Arrow for Sequence (Versions only) */}
                {groupType === 'version' && !isLastInGroup && (
                    <div className="absolute top-1/2 -right-6 z-10 text-gray-400 dark:text-gray-600">
                        <ArrowRight className="w-6 h-6" />
                    </div>
                )}

                {/* Overlay Actions (Only show if UNMASKED) */}
                {!isMasked && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-[1px] z-30">
                        <button
                            onClick={() => onKeepOnly(img.id)}
                            className="px-4 py-2 bg-sage-600 hover:bg-sage-500 text-white rounded-full font-bold text-xs shadow-lg transform hover:scale-105 transition-all flex items-center gap-2"
                        >
                            <Check className="w-3 h-3" /> Keep Only This
                        </button>
                    </div>
                )}
            </div>

            {/* Metadata Details */}
            <div className="mt-2 px-1">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate" title={img.filename}>
                    {img.filename}
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 flex justify-between">
                    <span>{new Date(img.timestamp).toLocaleDateString()}</span>
                    {isLastInGroup && groupType === 'version' && <span className="text-amethyst-500 font-bold">Newest</span>}
                </div>
            </div>
        </div>
    );
};

interface DuplicateFinderProps {
    images: AIImage[];
    onResolve: (keepId: string, deleteIds: string[]) => void;
    onStack?: (ids: string[]) => void;
    // Privacy
    maskedKeywords: string[];
    privacyEnabled: boolean;
}

export const DuplicateFinder: React.FC<DuplicateFinderProps> = ({
    images,
    onResolve,
    onStack,
    maskedKeywords,
    privacyEnabled
}) => {
    const { exactGroups, versionGroups, handleResolve, handleStack } = useDuplicateFinder(images, onResolve, onStack);
    const [activeTab, setActiveTab] = useState<'exact' | 'versions'>('exact');

    // ... (keep useEffect and empty state check same as before, skipping lines for brevity)
    // Actually I need to be careful with replace_file_content alignment. 
    // Let's target the top of the file and the render loop specifically if I can.
    // Or just rewrite the component start and then the loop.

    // Let's do the imports and props first.


    // Auto-switch tabs if one is empty
    React.useEffect(() => {
        if (exactGroups.length === 0 && versionGroups.length > 0) setActiveTab('versions');
        else if (exactGroups.length > 0 && versionGroups.length === 0) setActiveTab('exact');
    }, [exactGroups.length, versionGroups.length]);

    if (exactGroups.length === 0 && versionGroups.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 animate-in fade-in">
                <div className="p-6 bg-sage-500/10 rounded-full mb-6 border border-sage-500/20">
                    <Check className="w-16 h-16 text-sage-500" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Library is Clean</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400">No duplicate generations or unstacked versions detected.</p>
            </div>
        );
    }

    const currentGroups = activeTab === 'exact' ? exactGroups : versionGroups;

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4">

            {/* Tabs / Summary Banner */}
            <div className="mb-8 flex flex-col gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl p-1 flex">
                    <button
                        onClick={() => setActiveTab('exact')}
                        className={`flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'exact' ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Copy className="w-4 h-4" /> Exact Copies
                        <span className="px-2 py-0.5 bg-white dark:bg-black/20 rounded-full text-xs opacity-70">{exactGroups.length}</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('versions')}
                        className={`flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'versions' ? 'bg-amethyst-100 dark:bg-amethyst-900/40 text-amethyst-700 dark:text-amethyst-300 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Layers className="w-4 h-4" /> Upscales & Versions
                        <span className="px-2 py-0.5 bg-white dark:bg-black/20 rounded-full text-xs opacity-70">{versionGroups.length}</span>
                    </button>
                </div>

                <p className="text-sm text-gray-500 dark:text-gray-400 px-2">
                    {activeTab === 'exact'
                        ? "These groups contain identical images (Seed, Prompt, Model, AND Resolution). Safe to delete duplicates."
                        : "These groups share metadata but have different resolutions. You can stack them to organize your history."}
                </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 min-[1800px]:grid-cols-3 gap-6">
                {currentGroups.map((group) => (
                    <div key={group.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-lg transition-all hover:shadow-xl flex flex-col">
                        <div className="px-5 py-3 bg-gray-50 dark:bg-slate-950/30 border-b border-gray-200 dark:border-white/5 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                {group.type === 'exact' ? <Copy className="w-4 h-4 text-sage-500" /> : <Maximize2 className="w-4 h-4 text-amethyst-500" />}
                                <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                    {group.type === 'exact' ? 'Exact Duplicate' : 'Upscale Detected'}
                                </span>
                            </div>

                            {/* Header Actions */}
                            {group.type === 'version' && onStack && (
                                <button
                                    onClick={() => handleStack(group.id, group.images.map(i => i.id))}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amethyst-600 hover:bg-amethyst-500 text-white text-[10px] font-bold uppercase tracking-wide rounded-lg transition-colors shadow-sm"
                                >
                                    <Layers className="w-3 h-3" /> Stack All
                                </button>
                            )}
                        </div>

                        <div className="p-5 flex flex-col gap-4 flex-1">
                            {/* Horizontal Scroll Container */}
                            <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar scroll-px-0">
                                {group.images.map((img, idx) => (
                                    <DuplicateItem
                                        key={img.id}
                                        img={img}
                                        groupType={group.type}
                                        isLastInGroup={idx === group.images.length - 1}
                                        onKeepOnly={(imgId) => handleResolve(group.id, imgId, group.images.map(i => i.id))}
                                        privacyEnabled={privacyEnabled}
                                        maskedKeywords={maskedKeywords}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Conflict Info Footer */}
                        <div className={`mt-auto flex items-center gap-3 p-3 border border-dashed rounded-lg ${activeTab === 'exact' ? 'border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-slate-900/50' : 'border-amethyst-200 dark:border-amethyst-900/30 bg-amethyst-50/50 dark:bg-amethyst-900/10'}`}>
                            <div className={`p-2 rounded-full ${activeTab === 'exact' ? 'bg-sage-100 dark:bg-sage-900/20 text-sage-600' : 'bg-amethyst-100 dark:bg-amethyst-900/20 text-amethyst-600'}`}>
                                {activeTab === 'exact' ? <AlertTriangle className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                            </div>
                            <div className="flex-1">
                                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                    {activeTab === 'exact' ? 'Redundant Copies' : 'Workflow History'}
                                </p>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                    {activeTab === 'exact'
                                        ? `Keeping one will delete ${group.images.length - 1} duplicates.`
                                        : `Stacking will group these ${group.images.length} versions together in your library.`}
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};