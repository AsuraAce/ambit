import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { AIImage } from '../../../types';

interface VersionSelectorProps {
    versions: AIImage[];
    activeVersionId: string;
    onVersionSelect: (id: string) => void;
    showControls: boolean;
}

export const VersionSelector: React.FC<VersionSelectorProps> = ({
    versions,
    activeVersionId,
    onVersionSelect,
    showControls
}) => {
    if (versions.length <= 1) return null;

    return (
        <div className={`absolute bottom-24 left-1/2 -translate-x-1/2 z-30 flex items-end gap-3 p-2 rounded-2xl bg-black/70 backdrop-blur-md border border-white/10 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            {versions.map((v) => {
                const isActive = v.id === activeVersionId;
                const isUpscale = v.width > versions[0].width;
                return (
                    <button
                        key={v.id}
                        onClick={(e) => { e.stopPropagation(); onVersionSelect(v.id); }}
                        className={`relative group/thumb w-14 h-20 rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-pointer ${isActive ? 'border-sage-500 scale-110 z-10 shadow-[0_0_15px_rgba(115,140,85,0.5)]' : 'border-transparent opacity-60 hover:opacity-100 hover:scale-105 hover:border-white/20'}`}
                    >
                        <img src={v.thumbnailUrl} className="w-full h-full object-cover" alt="" />

                        {/* Resolution Badge */}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-white text-center py-0.5 font-mono">
                            {v.width}w
                        </div>

                        {/* Upscale Icon */}
                        {isUpscale && (
                            <div className="absolute top-1 right-1 p-0.5 bg-amethyst-500 rounded-full shadow-sm">
                                <ArrowRight className="w-2 h-2 text-white -rotate-45" />
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
};
