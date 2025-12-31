import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Monitor, Loader2 } from "lucide-react";
import { useSearch } from "../../contexts/SearchContext";

const ProgressOverlay = () => {
    const { isRegeneratingThumbnails, thumbnailProgress, isImporting, importProgress } = useSearch();

    const active = isRegeneratingThumbnails || isImporting;
    const progress = isRegeneratingThumbnails ? thumbnailProgress : importProgress;
    const label = isRegeneratingThumbnails ? "Optimizing" : "Importing";

    if (!active) return null;

    const percent = progress ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <div className="flex items-center gap-3 px-4 py-1 bg-sage-500/10 border border-sage-500/20 rounded-full animate-in fade-in zoom-in duration-300">
            <Loader2 className="w-3 h-3 text-sage-500 animate-spin" />
            <div className="flex flex-col">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-sage-600 dark:text-sage-400 uppercase tracking-wider">{label}</span>
                    <span className="text-[10px] font-medium text-gray-500">{progress?.current} / {progress?.total}</span>
                </div>
                <div className="w-32 h-1 bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden mt-0.5">
                    <div
                        className="h-full bg-sage-500 transition-all duration-300 ease-out"
                        style={{ width: `${percent}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

export const TitleBar = () => {
    const [appWindow, setAppWindow] = useState<any>(null);
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        const initWindow = async () => {
            try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const win = getCurrentWindow();
                setAppWindow(win);

                setIsMaximized(await win.isMaximized());
                const updateState = async () => setIsMaximized(await win.isMaximized());
                const unlisten = await win.listen('tauri://resize', updateState);

                return () => unlisten();
            } catch (e) {
                console.warn("TitleBar: Not in Tauri environment");
            }
        };
        initWindow();
    }, []);

    const handleMinimize = () => appWindow?.minimize();
    const handleMaximize = async () => {
        if (!appWindow) return;
        const current = await appWindow.isMaximized();
        if (current) {
            await appWindow.unmaximize();
        } else {
            await appWindow.maximize();
        }
        setIsMaximized(!current);
    };
    const handleClose = () => appWindow?.close();

    if (!appWindow) return null; // Don't render if not in Tauri (or loading)

    return (
        <div data-tauri-drag-region className="w-full flex-none h-8 bg-background flex justify-between items-center select-none z-50 border-b border-gray-200 dark:border-white/5 transition-colors">
            <div className="flex items-center gap-2 px-3 pointer-events-none">
                <div className="w-3 h-3 bg-sage-500 rounded-full" />
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">AMBIT</span>
            </div>

            {/* Global Progress Indicator */}
            <ProgressOverlay />

            <div className="flex h-full">
                <button
                    onClick={handleMinimize}
                    className="h-full px-4 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                    <Minus className="w-4 h-4" />
                </button>
                <button
                    onClick={handleMaximize}
                    className="h-full px-4 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                    {isMaximized ? (
                        <div className="relative w-3 h-3">
                            <Square className="w-3 h-3 absolute -top-0.5 -right-0.5 opacity-50" />
                            <Square className="w-3 h-3 absolute -bottom-0.5 -left-0.5" />
                        </div>
                    ) : (
                        <Square className="w-3 h-3" />
                    )}
                </button>
                <button
                    onClick={handleClose}
                    className="h-full px-4 hover:bg-red-500 flex items-center justify-center transition-colors text-gray-500 hover:text-white dark:text-gray-400"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
