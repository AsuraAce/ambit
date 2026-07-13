import * as React from 'react';
import { useState } from 'react';
import { ArrowRight, Layers, CheckCircle2, Maximize, Check, X, Hash } from 'lucide-react';
import { AIImage } from '../../../types';
import { StackGroup as IStackGroup } from '../../../hooks/useStacking';

interface StackGroupProps {
    group: IStackGroup;
    onConfirm: (baseId: string, relatedIds: string[]) => void;
}

export const StackGroup: React.FC<StackGroupProps> = ({ group, onConfirm }) => {
    const { baseImage, relatedImages } = group;
    // We combine all initially detected images
    const allImages = [baseImage, ...relatedImages];

    // Track which images are currently selected for the group
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(allImages.map(i => i.id)));

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleConfirm = () => {
        // Filter the master list by selection
        const finalSelection = allImages.filter(img => selectedIds.has(img.id));

        // Re-sort by timestamp/size to find the new "Base" (in case original base was deselected)
        // We stick to time-based ordering for the stack structure.
        finalSelection.sort((a, b) => a.timestamp - b.timestamp);

        const newBase = finalSelection[0];
        const newRelated = finalSelection.slice(1).map(i => i.id);

        onConfirm(newBase.id, newRelated);
    };

    const selectedCount = selectedIds.size;

    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-md transition-all hover:shadow-lg">
            {/* Header */}
            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-950/30 border-b border-gray-200 dark:border-white/5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-amethyst-100 dark:bg-amethyst-900/30 rounded text-amethyst-600 dark:text-amethyst-400">
                        <Layers className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
                            {group.reason || 'Workflow Detected'}
                        </div>
                        <div className="text-[10px] text-gray-400">
                            {allImages.length} candidates found • {new Date(baseImage.timestamp).toLocaleTimeString()}
                        </div>
                    </div>
                </div>
                <button
                    onClick={handleConfirm}
                    disabled={selectedCount < 2}
                    className="flex items-center gap-2 px-3 py-1.5 bg-sage-600 hover:bg-sage-500 disabled:bg-gray-300 disabled:dark:bg-zinc-800 disabled:text-gray-500 text-white rounded-lg text-xs font-bold shadow-sm transition-colors"
                >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Group ({selectedCount})
                </button>
            </div>

            {/* Timeline Strip */}
            <div className="p-4 flex items-center gap-4 overflow-x-auto custom-scrollbar">
                {allImages.map((img, idx) => {
                    const isSelected = selectedIds.has(img.id);
                    const isUpscale = idx > 0 && img.width > allImages[idx - 1].width;

                    return (
                        <React.Fragment key={img.id}>
                            {idx > 0 && (
                                <div className={`flex-shrink-0 transition-opacity ${isSelected ? 'text-gray-300 dark:text-gray-600' : 'text-gray-200 dark:text-zinc-800 opacity-30'}`}>
                                    <ArrowRight className="w-4 h-4" />
                                </div>
                            )}

                            <div
                                onClick={() => toggleSelection(img.id)}
                                className={`flex-shrink-0 relative group cursor-pointer transition-all duration-300 ${isSelected ? 'opacity-100 scale-100' : 'opacity-50 grayscale scale-95'}`}
                            >
                                <div className={`w-32 aspect-square rounded-lg overflow-hidden border-2 relative transition-colors ${isSelected ? 'border-sage-500 shadow-md' : 'border-gray-200 dark:border-white/5'}`}>
                                    <img src={img.thumbnailUrl} alt="" className="w-full h-full object-cover" />

                                    {/* Selection Indicator Overlay */}
                                    <div className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${isSelected ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isSelected ? 'bg-red-500 text-white' : 'bg-sage-500 text-white'}`}>
                                            {isSelected ? <X className="w-5 h-5" /> : <Check className="w-5 h-5" />}
                                        </div>
                                    </div>

                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-[2px] p-1 text-[10px] text-white text-center font-mono truncate">
                                        {img.width}x{img.height}
                                    </div>
                                    <div className="absolute top-0 right-0 bg-black/60 p-1 text-[9px] text-white font-mono flex items-center gap-0.5 rounded-bl-lg z-20">
                                        <Hash className="w-2 h-2 text-sage-400" /> {img.metadata.seed === undefined ? '?' : img.metadata.seed.toString().slice(-4)}
                                    </div>
                                </div>

                                {/* Upscale Badge */}
                                {isUpscale && isSelected && (
                                    <div className="absolute -top-2 -right-2 bg-amethyst-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm flex items-center gap-1 z-10">
                                        <Maximize className="w-2 h-2" /> Upscale
                                    </div>
                                )}

                                <div className="mt-1.5 text-center">
                                    <div className={`text-[10px] font-bold rounded px-1.5 py-0.5 inline-block ${isSelected ? 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/5' : 'text-gray-400 bg-transparent'}`}>
                                        {idx === 0 ? 'Base' : `Pass ${idx + 1}`}
                                    </div>
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};
