import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link2, FileUp, FolderOpen, Check, Zap, Sparkles, AlertCircle, ArrowRight } from 'lucide-react';

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings: (tab: 'invokeai' | 'a1111' | 'comfyui' | 'folders') => void;
    onImportFiles: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
    isOpen,
    onClose,
    onOpenSettings,
    onImportFiles
}) => {
    const dialogRef = React.useRef<HTMLDivElement>(null);
    const headingRef = React.useRef<HTMLHeadingElement>(null);

    React.useEffect(() => {
        if (isOpen) headingRef.current?.focus();
    }, [isOpen]);

    const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab' || !dialogRef.current) return;

        const focusableElements = Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled'));

        if (focusableElements.length === 0) {
            event.preventDefault();
            dialogRef.current.focus();
            return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        if (!activeElement || !focusableElements.includes(activeElement)) {
            event.preventDefault();
            (event.shiftKey ? lastElement : firstElement).focus();
            return;
        }

        if (event.shiftKey && activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
        } else if (!event.shiftKey && activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
        }
    };

    const handleOpenSettings = (tab: 'invokeai' | 'a1111' | 'comfyui' | 'folders') => {
        onOpenSettings(tab);
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    <motion.div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="import-modal-title"
                        tabIndex={-1}
                        onKeyDown={handleDialogKeyDown}
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0c0c0e]"
                    >
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-transparent via-transparent to-sage-500/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-sage-500/10 rounded-lg">
                                    <Sparkles className="w-5 h-5 text-sage-500" />
                                </div>
                                <h2
                                    id="import-modal-title"
                                    ref={headingRef}
                                    tabIndex={-1}
                                    className="text-xl font-black text-gray-900 dark:text-white tracking-tight outline-none"
                                >
                                    Add Images to Your Library
                                </h2>
                            </div>
                            <button
                                type="button"
                                aria-label="Close Add Images"
                                onClick={onClose}
                                className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-all active:scale-95"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-8 space-y-8">
                            {/* RECOMMENDED SECTION */}
                            <section>
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-sage-600 dark:text-sage-400 bg-sage-500/10 px-2 py-0.5 rounded">Recommended</span>
                                </div>

                                <motion.div
                                    whileHover={{ y: -2 }}
                                    className="relative group p-6 rounded-2xl bg-gradient-to-br from-gray-50 to-white dark:from-white/[0.03] dark:to-transparent border border-gray-100 dark:border-white/10 shadow-xl shadow-black/5"
                                >
                                    {/* Accent Glow */}
                                    <div className="absolute inset-0 bg-sage-500/5 opacity-0 group-hover:opacity-100 blur-2xl transition-opacity duration-500 pointer-events-none" />

                                    <div className="relative flex gap-6">
                                        <div className="flex-shrink-0">
                                            <div className="w-16 h-16 bg-white dark:bg-zinc-800 rounded-2xl shadow-lg border border-gray-100 dark:border-white/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-500 overflow-hidden relative">
                                                <div className="absolute inset-0 bg-gradient-to-br from-sage-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                                <Link2 className="w-8 h-8 text-sage-500 relative z-10" />
                                            </div>
                                        </div>

                                        <div className="flex-1">
                                            <h3 className="text-lg font-black text-gray-900 dark:text-white mb-1 tracking-tight">Set Up Integration</h3>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 font-medium">Automatic imports from connected generator output folders.</p>

                                            <ul className="grid grid-cols-1 gap-2 mb-6">
                                                <FeatureItem text="Auto-import new images" />
                                                <FeatureItem text="Sync favorites & boards when supported" />
                                                <FeatureItem text="Full metadata extraction" />
                                            </ul>

                                            <div className="flex flex-wrap gap-2">
                                                <IntegrationButton label="InvokeAI" onClick={() => handleOpenSettings('invokeai')} color="indigo" />
                                                <IntegrationButton label="ComfyUI" onClick={() => handleOpenSettings('comfyui')} color="emerald" />
                                                <IntegrationButton label="SD WebUI" onClick={() => handleOpenSettings('a1111')} color="amber" />
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            </section>

                            {/* DIVIDER */}
                            <div className="relative flex items-center justify-center">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-gray-100 dark:border-white/5" />
                                </div>
                                <span className="relative px-4 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 bg-white dark:bg-[#0c0c0e]">or</span>
                            </div>

                            {/* MANUAL IMPORT SECTION */}
                            <section>
                                <div className="flex items-center gap-3 mb-4">
                                    <FolderOpen className="w-4 h-4 text-gray-400" />
                                    <h3 className="font-black text-sm text-gray-900 dark:text-white tracking-tight">One-Time Import</h3>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 font-medium leading-relaxed">
                                    For images from downloaded packs, other apps, or screenshots.
                                </p>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { onImportFiles(); onClose(); }}
                                        className="flex-1 px-4 py-4 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-xl text-xs font-black transition-all hover:translate-y-[-2px] hover:shadow-xl active:translate-y-0 active:scale-95 flex items-center justify-center gap-2 group shadow-lg"
                                    >
                                        <FileUp className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                        Select Files
                                    </button>
                                    <button
                                        onClick={() => handleOpenSettings('folders')}
                                        className="flex-1 px-4 py-4 bg-gray-50 dark:bg-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-900 dark:text-white rounded-xl text-xs font-black transition-all hover:translate-y-[-2px] active:translate-y-0 active:scale-95 border border-gray-200 dark:border-white/5 flex items-center justify-center gap-2 group"
                                    >
                                        <FolderOpen className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                        Add Folder
                                    </button>
                                </div>
                            </section>
                        </div>

                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

const FeatureItem = ({ text }: { text: string }) => (
    <li className="flex items-center gap-2">
        <div className="flex-shrink-0 w-4 h-4 rounded-full bg-sage-500/10 flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-sage-500 stroke-[4]" />
        </div>
        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-400">{text}</span>
    </li>
);

const IntegrationButton = ({ label, onClick, color }: { label: string, onClick: () => void, color: 'indigo' | 'emerald' | 'amber' }) => {
    const styles = {
        indigo: 'hover:bg-indigo-500 hover:text-white border-indigo-500/20 text-indigo-500 bg-indigo-500/5',
        emerald: 'hover:bg-emerald-500 hover:text-white border-emerald-500/20 text-emerald-500 bg-emerald-500/5',
        amber: 'hover:bg-amber-500 hover:text-white border-amber-500/20 text-amber-500 bg-amber-500/5',
    }[color];

    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-tight transition-all duration-300 active:scale-95 ${styles}`}
        >
            {label}
        </button>
    );
};
