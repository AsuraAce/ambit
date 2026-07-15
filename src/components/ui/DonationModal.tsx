import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coffee, Heart, X } from 'lucide-react';
import { APP_NAME } from '../../constants/app';
import { ENABLED_DONATION_PROVIDERS } from '../../constants/support';
import { openExternalUrl } from '../../utils/externalLinks';

interface DonationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const DonationModal: React.FC<DonationModalProps> = ({ isOpen, onClose }) => {
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        if (!isOpen) return;

        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();

        return () => {
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [isOpen]);

    const handleOpenLink = async (url: string) => {
        await openExternalUrl(url);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl p-6 relative overflow-hidden"
                        onClick={(e) => e.stopPropagation()} // Prevent click from closing modal when clicking content
                    >

                        {/* Decorative Background */}
                        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-br from-sage-500/20 to-amethyst-500/20 pointer-events-none" />

                        <button
                            ref={closeButtonRef}
                            type="button"
                            aria-label="Close Support Dialog"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                            }}
                            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors z-20 cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="relative z-10 flex flex-col items-center text-center pt-4">
                            <div className="w-16 h-16 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg mb-4 border border-gray-100 dark:border-gray-700">
                                <Heart className="w-8 h-8 text-red-500 fill-current animate-pulse" />
                            </div>

                            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Support {APP_NAME}</h2>
                            <p className="text-gray-600 dark:text-gray-400 text-sm mb-8 leading-relaxed max-w-xs">
                                If Ambit helps you manage your image library, optional support helps fund development, testing, packaging, and maintenance.
                            </p>

                            {ENABLED_DONATION_PROVIDERS.length > 0 ? (
                                <div className="flex flex-col gap-3 w-full">
                                    {ENABLED_DONATION_PROVIDERS.map((provider) => {
                                        const ProviderIcon = provider.id === 'github-sponsors' ? Heart : Coffee;
                                        const isKoFi = provider.id === 'ko-fi';

                                        return (
                                            <button
                                                key={provider.id}
                                                type="button"
                                                onClick={() => provider.url && handleOpenLink(provider.url)}
                                                className={`flex items-center justify-center gap-3 w-full py-3 rounded-xl font-bold transition-all shadow-lg hover:scale-[1.02] ${isKoFi
                                                    ? 'bg-[#FF5E5B] hover:bg-[#ff4845] text-white'
                                                    : 'bg-gray-800 hover:bg-gray-700 dark:bg-white dark:hover:bg-gray-200 text-white dark:text-gray-900'
                                                    }`}
                                            >
                                                <ProviderIcon className="w-5 h-5" /> {provider.ctaLabel}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="w-full rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/90 dark:bg-black/20 px-4 py-4 text-left">
                                    <div className="font-semibold text-gray-900 dark:text-white">Donations are not configured yet</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        Add your Ko-fi, GitHub Sponsors, or Patreon URL in <code>src/constants/support.ts</code> when the pages are live.
                                    </div>
                                </div>
                            )}

                            <div className="mt-8 text-xs text-gray-400">
                                Thank you for being part of the journey.
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
