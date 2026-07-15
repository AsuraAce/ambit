import * as React from 'react';
import { Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';

interface PrivacyProtectionGateProps {
    onOpenSettings?: () => void;
    className?: string;
}

export const PrivacyProtectionGate: React.FC<PrivacyProtectionGateProps> = ({
    onOpenSettings,
    className = '',
}) => {
    const status = useSettingsStore(state => state.privacyMaskIndexStatus);
    const error = useSettingsStore(state => state.privacyMaskIndexError);
    const retry = useSettingsStore(state => state.retryPrivacyMaskIndex);
    const failed = status === 'failed';

    return (
        <div
            className={`h-full w-full flex items-center justify-center p-8 bg-gray-50 dark:bg-zinc-950 ${className}`}
            role={failed ? 'alert' : 'status'}
            aria-live="polite"
            data-testid="privacy-protection-gate"
        >
            <div className="max-w-md text-center">
                {failed ? (
                    <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-rose-500" />
                ) : (
                    <Loader2 className="w-10 h-10 mx-auto mb-4 text-sage-500 animate-spin" />
                )}
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {failed ? 'Privacy protection needs attention' : 'Preparing privacy protection'}
                </h2>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    {failed
                        ? 'Library content remains hidden because the privacy index could not be refreshed.'
                        : 'Library content will appear after the latest masking rules are ready.'}
                </p>
                {failed && error && (
                    <p className="mt-3 text-xs text-rose-600 dark:text-rose-400 break-words">{error}</p>
                )}
                {failed && (
                    <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <button
                            type="button"
                            onClick={retry}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sage-600 hover:bg-sage-500 text-white text-sm font-bold"
                        >
                            <RotateCcw className="w-4 h-4" /> Retry
                        </button>
                        {onOpenSettings && (
                            <button
                                type="button"
                                onClick={onOpenSettings}
                                className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-white/10 dark:hover:bg-white/15 text-sm font-bold text-gray-800 dark:text-gray-200"
                            >
                                Open Privacy Settings
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
