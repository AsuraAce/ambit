import * as React from 'react';
import { useState } from 'react';
import { EyeOff, Eye, CheckSquare } from 'lucide-react';
import { AIImage } from '../../../types';
import { isImageMasked } from '../../../utils/maskingUtils';

interface MaintenanceItemProps {
    img: AIImage;
    style: React.CSSProperties;
    isSelected?: boolean;
    onClick: (e: React.MouseEvent) => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
    children?: React.ReactNode;
    showFilename?: boolean;
    imageClassName?: string;
    overlayActions?: React.ReactNode;
    isMissing?: boolean;
}

export const MaintenanceItem: React.FC<MaintenanceItemProps> = ({
    img,
    style,
    isSelected,
    onClick,
    privacyEnabled,
    maskedKeywords,
    children,
    showFilename = true,
    imageClassName = '',
    overlayActions,
    isMissing = false
}) => {
    const [isRevealed, setRevealed] = useState(false);
    const isMasked = !isRevealed && isImageMasked(img, privacyEnabled, maskedKeywords);

    return (
        <div style={style} className="p-1">
            <div
                onClick={onClick}
                className={`h-full w-full rounded-xl overflow-hidden border-2 transition-all cursor-pointer relative ${isSelected ? 'border-sage-500 ring-2 ring-sage-500/30 shadow-lg shadow-sage-500/10' : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-gray-100 dark:bg-slate-800'}`}
                onMouseLeave={() => isRevealed && setRevealed(false)}
            >
                <div className="relative w-full h-full">
                    <img
                        src={img.thumbnailUrl}
                        loading="lazy"
                        className={`w-full h-full object-cover transition-all ${imageClassName} ${isMasked ? 'blur-xl scale-110' : ''} ${isMissing ? 'opacity-50 grayscale' : ''}`}
                        alt=""
                    />

                    {isMissing && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/10 pointer-events-none">
                            <span className="bg-red-600 text-white text-[9px] font-bold uppercase px-2 py-0.5 rounded shadow-lg">Missing Source</span>
                        </div>
                    )}

                    {/* Mask Overlay */}
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

                    {overlayActions && !isMasked && (
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center z-20">
                            {overlayActions}
                        </div>
                    )}

                    {isSelected && (
                        <div className="absolute top-2 left-2 w-6 h-6 bg-sage-500 rounded-full flex items-center justify-center shadow-md z-30">
                            <CheckSquare className="w-3.5 h-3.5 text-white" />
                        </div>
                    )}

                    {children}

                    {showFilename && (
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-[10px] text-white truncate z-20">
                            {img.filename}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
