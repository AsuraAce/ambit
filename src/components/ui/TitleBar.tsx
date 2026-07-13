import { useState, useEffect } from "react";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { APP_NAME } from "../../constants/app";
import { useSettingsStore } from "../../stores/settingsStore";
import { isTauriRuntime } from "../../services/runtime";
import { areDeveloperFeaturesEnabled } from "../../utils/settingsUtils";

const BRAND_GLYPH_SRC = "/branding/ambit-glyph.svg";
const BRAND_WINDOW_ICON_SRC = "/branding/ambit-window-icon.png";

export const TitleBar = () => {
    const [appWindow, setAppWindow] = useState<TauriWindow | null>(null);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showOnHover, setShowOnHover] = useState(false);
    const developerFeaturesEnabled = useSettingsStore(s => areDeveloperFeaturesEnabled(s.settings));

    useEffect(() => {
        if (!isTauriRuntime()) return;
        let cleanup: (() => void) | undefined;
        let disposed = false;

        const initWindow = async () => {
            try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const win = getCurrentWindow();
                setAppWindow(win);

                try {
                    await win.setIcon(BRAND_WINDOW_ICON_SRC);
                } catch (iconError) {
                    console.warn("TitleBar: Failed to set window icon", iconError);
                }

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

                const disposeListeners = () => {
                    unlistenResize();
                    window.removeEventListener('keydown', handleKeyDown);
                };
                if (disposed) {
                    disposeListeners();
                } else {
                    cleanup = disposeListeners;
                }
            } catch (e) {
                console.warn("TitleBar: Not in Tauri environment");
            }
        };
        void initWindow();
        return () => {
            disposed = true;
            cleanup?.();
        };
    }, []);

    const handleMinimize = () => appWindow?.minimize();
    const handleMaximize = async () => {
        const current = await appWindow!.isMaximized();
        if (current) {
            await appWindow!.unmaximize();
        } else {
            await appWindow!.maximize();
        }
        setIsMaximized(!current);
    };
    const handleClose = () => appWindow?.close();

    if (!appWindow) return null;

    // Fullscreen styling logic
    // We only retract if we are truly in fullscreen (not just maximized)
    const isRetracting = isFullscreen && !isMaximized;
    const containerClasses = isRetracting
        ? `fixed top-0 left-0 right-0 z-[100] transform transition-transform duration-500 ease-spring ${showOnHover ? 'translate-y-0' : '-translate-y-full'}`
        : 'w-full flex-none h-10 relative z-50';

    return (
        <>
            {/* Hover Trigger for Fullscreen */}
            {isRetracting && (
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
                <div className="flex items-center gap-3 pointer-events-none">
                    <img
                        src={BRAND_GLYPH_SRC}
                        alt=""
                        className="h-7 w-7 shrink-0 drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                    />
                    <span className="text-[13px] font-semibold tracking-[0.18em] text-zinc-700 dark:text-zinc-300">
                        {APP_NAME.toUpperCase()}
                    </span>
                    {developerFeaturesEnabled && (
                        <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-500 text-[9px] font-bold rounded animate-pulse">
                            DEV
                        </span>
                    )}
                </div>

                <div className="flex h-full">
                    <button
                        type="button"
                        aria-label="Minimize Window"
                        onClick={handleMinimize}
                        className="h-full px-4 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/70 focus-visible:bg-gray-100 dark:focus-visible:bg-white/10"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        aria-label={isMaximized ? "Restore Window" : "Maximize Window"}
                        onClick={handleMaximize}
                        className="h-full px-4 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-center transition-colors text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/70 focus-visible:bg-gray-100 dark:focus-visible:bg-white/10"
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
                        type="button"
                        aria-label="Close Window"
                        onClick={handleClose}
                        className="h-full px-4 hover:bg-red-500 flex items-center justify-center transition-colors text-gray-500 hover:text-white dark:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-300 focus-visible:bg-red-500 focus-visible:text-white"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </header>
        </>
    );
};
