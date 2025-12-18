import { UploadCloud } from 'lucide-react';

interface DragOverlayProps {
    isVisible: boolean;
}

export function DragOverlay({ isVisible }: DragOverlayProps) {
    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-200">
            <div className="p-8 bg-white/10 border-2 border-dashed border-white/30 rounded-3xl flex flex-col items-center gap-4 text-white animate-bounce">
                <UploadCloud className="w-16 h-16 text-sage-400" />
                <h2 className="text-2xl font-bold">Drop to Import</h2>
                <p className="text-white/60">Release files to add them to your library</p>
            </div>
        </div>
    );
}
