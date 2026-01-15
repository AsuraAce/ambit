import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Monitor, Loader2 } from "lucide-react";
import { useLibraryContext } from "../../hooks/useLibraryContext";
import { APP_NAME } from "../../constants/app";



import { useSettingsStore } from "../../stores/settingsStore";

export const TitleBar = () => {
    const [appWindow, setAppWindow] = useState<any>(null);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showOnHover, setShowOnHover] = useState(false);
    const devModeEnabled = useSettingsStore(s => s.devModeEnabled);

    useEffect(() => {
        const initWindow = async () => {
            try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const win = getCurrentWindow();
                setAppWindow(win);

                setIsMaximized(await win.isMaximized());
                setIsFullscreen(await win.isFullscreen());

                const unlistenResize = await win.listen('tauri://resize', async () => {
                    setIsMaximized(await win.isMaximized());
                    setIsFullscreen(await win.isFullscreen());
                });

                // F11 Handler
                const handleKeyDown = async (e: KeyboardEvent) => {
                    if (e.key === 'F11') {
                        e.preventDefault();
                        const current = await win.isFullscreen();
                        await win.setFullscreen(!current);
                        setIsFullscreen(!current);
                    }
                };

                window.addEventListener('keydown', handleKeyDown);

                return () => {
                    unlistenResize();
                    window.removeEventListener('keydown', handleKeyDown);
                };
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

    if (!appWindow) return null;

    // Fullscreen styling logic
    // We use absolute positioning in fullscreen so it slides OVER the content instead of pushing it.
    // In windowed mode, we keep it in the flex flow to prevent it from overlapping the AppHeader.
    const containerClasses = isFullscreen
        ? `fixed top-0 left-0 right-0 z-[100] transform transition-transform duration-500 ease-spring ${showOnHover ? 'translate-y-0' : '-translate-y-full'}`
        : 'w-full flex-none h-10 relative z-50';

    return (
        <>
            {/* Hover Trigger for Fullscreen */}
            {isFullscreen && (
                <div
                    className="fixed top-0 left-0 right-0 h-4 z-[99]"
                    onMouseEnter={() => setShowOnHover(true)}
                />
            )}

            <header
                data-tauri-drag-region
                onMouseLeave={() => setShowOnHover(false)}
                className={`${containerClasses} flex items-center justify-between px-4 bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border-b border-gray-200 dark:border-white/10 select-none transition-all duration-300 shadow-xl`}
            >
                <div className="flex items-center gap-2 pointer-events-none">
                    <div className="w-3 h-3 bg-sage-500 rounded-full" />
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{APP_NAME.toUpperCase()}</span>
                    {devModeEnabled && (
                        <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-500 text-[9px] font-bold rounded animate-pulse">
                            DEV
                        </span>
                    )}
                </div>

                <div className="flex h-full">
                    <button
                        onClick={handleMinimize}
                        className="h-full px-4 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white outline-none focus:outline-none"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleMaximize}
                        className="h-full px-4 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white outline-none focus:outline-none"
                    >
                        {isMaximized ? (
                            <div className="relative w-3 h-3 pointer-events-none">
                                <Square className="w-3 h-3 absolute -top-0.5 -right-0.5 opacity-50" />
                                <Square className="w-3 h-3 absolute -bottom-0.5 -left-0.5" />
                            </div>
                        ) : (
                            <Square className="w-4 h-4" />
                        )}
                    </button>
                    <button
                        onClick={handleClose}
                        className="h-full px-4 hover:bg-red-500 flex items-center justify-center transition-colors text-gray-500 hover:text-white dark:text-gray-400 outline-none focus:outline-none"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </header>
        </>
    );
};
