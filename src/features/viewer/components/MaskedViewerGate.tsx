import * as React from 'react';
import { EyeOff, X } from 'lucide-react';

interface MaskedViewerGateProps {
    mediaLabel: 'image' | 'video';
    onReveal: () => void;
    onClose: () => void;
}

export const MaskedViewerGate: React.FC<MaskedViewerGateProps> = ({
    mediaLabel,
    onReveal,
    onClose,
}) => (
    <div
        role="dialog"
        aria-modal="true"
        aria-label={`Hidden ${mediaLabel}`}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-white"
    >
        <button
            type="button"
            aria-label={`Close ${mediaLabel} viewer`}
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-black/70 p-2.5 hover:bg-white/15"
        >
            <X className="h-5 w-5" />
        </button>
        <div className="flex max-w-md flex-col items-center rounded-2xl border border-white/10 bg-zinc-900 p-8 text-center shadow-2xl">
            <EyeOff className="mb-4 h-10 w-10 text-sage-400" />
            <h2 className="text-xl font-bold">Hidden {mediaLabel}</h2>
            <p className="mt-2 text-sm text-zinc-400">
                The full {mediaLabel} will not load until you reveal this item.
            </p>
            <button
                type="button"
                onClick={onReveal}
                className="mt-6 rounded-lg bg-sage-500 px-5 py-2.5 font-bold text-white"
            >
                Reveal {mediaLabel}
            </button>
        </div>
    </div>
);
