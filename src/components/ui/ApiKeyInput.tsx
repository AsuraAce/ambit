import * as React from 'react';
import { Key, Check, XCircle, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import { cn } from '../../utils/cn';
import { GEMINI_API_KEY_URL, openExternalUrl } from '../../utils/externalLinks';

interface ApiKeyInputProps {
    value: string;
    onChange: (value: string) => void;
    onVerify: () => Promise<void>;
    isVerifying: boolean;
    status: 'idle' | 'configured' | 'success' | 'error';
    error?: string | null;
    isEnvKey?: boolean;
    onTestEnvKey?: () => void;
    placeholder?: string;
    label?: string;
    showLabel?: boolean;
    className?: string;
}

export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
    value,
    onChange,
    onVerify,
    isVerifying,
    status,
    error,
    isEnvKey = false,
    onTestEnvKey,
    placeholder = "Paste your API key here…",
    label = "Gemini API key",
    showLabel = true,
    className
}) => {
    const inputId = React.useId();
    const labelId = `${inputId}-label`;
    const hasPositiveStatus = status === 'success' || (!isEnvKey && status === 'configured');
    const statusMessage = status === 'success'
        ? isEnvKey
            ? 'Environment API key verified'
            : 'API key verified and saved'
        : status === 'configured' && !isEnvKey
            ? 'API key configured'
            : null;
    const verifyLabel = status === 'configured'
        ? 'Re-verify'
        : status === 'success'
            ? 'Verified'
            : 'Verify';

    return (
        <div className={cn("space-y-2", className)}>
            {showLabel && (
                <div className="flex justify-between items-end mb-2">
                    {isEnvKey ? (
                        <span id={labelId} className="text-xs font-bold text-gray-500 uppercase tracking-widest leading-none">{label}</span>
                    ) : (
                        <label htmlFor={inputId} className="text-xs font-bold text-gray-500 uppercase tracking-widest leading-none">{label}</label>
                    )}
                    <button
                        type="button"
                        onClick={() => { void openExternalUrl(GEMINI_API_KEY_URL); }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-sage-600 dark:text-sage-400 hover:text-sage-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 rounded"
                    >
                        Get a Gemini API key
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </button>
                </div>
            )}

            {isEnvKey ? (
                <div className="space-y-4">
                    <div
                        role="group"
                        aria-label={showLabel ? undefined : label}
                        aria-labelledby={showLabel ? labelId : undefined}
                        className="flex items-center gap-3 p-4 bg-sage-500/10 border border-sage-500/20 rounded-xl text-sm text-sage-700 dark:text-sage-300"
                    >
                        <Key className="w-5 h-5 text-sage-500" />
                        <span className="font-medium">Environment API key detected</span>
                        <div className="flex-1" />
                        {hasPositiveStatus ? (
                            <Check className="w-4 h-4 text-sage-500 animate-in fade-in zoom-in" />
                        ) : null}
                        {status === 'error' && (
                            <XCircle className="w-4 h-4 text-red-500 animate-in fade-in zoom-in" />
                        )}
                        <button
                            type="button"
                            onClick={onTestEnvKey}
                            disabled={isVerifying}
                            className="px-3 py-1.5 bg-sage-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-sage-600 transition-all flex items-center gap-2"
                        >
                            {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            {isVerifying ? 'Checking' : 'Test environment key'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="relative group">
                        <input
                            id={inputId}
                            type="password"
                            aria-label={showLabel ? undefined : label}
                            placeholder={placeholder}
                            value={value}
                            readOnly={isVerifying}
                            onChange={(e) => {
                                if (!isVerifying) onChange(e.target.value);
                            }}
                            className={cn(
                                "w-full bg-gray-50 dark:bg-white/5 border rounded-xl px-4 py-4 pr-32 text-sm outline-none transition-all",
                                isVerifying && 'cursor-wait opacity-70',
                                hasPositiveStatus ? 'border-sage-500/50 dark:text-sage-500' :
                                    status === 'error' ? 'border-red-500/50' :
                                        'border-gray-200 dark:border-white/10 focus:border-sage-500/50 focus:ring-4 focus:ring-sage-500/5 dark:text-white'
                            )}
                        />
                        <div className="absolute right-2 top-2 bottom-2 flex items-center gap-2">
                            {hasPositiveStatus ? (
                                <Check className="w-5 h-5 text-sage-500 animate-in fade-in zoom-in" />
                            ) : null}
                            {status === 'error' && (
                                <XCircle className="w-5 h-5 text-red-500 animate-in fade-in zoom-in" />
                            )}
                            <button
                                type="button"
                                onClick={onVerify}
                                disabled={isVerifying || !value || status === 'success'}
                                className="h-full px-4 bg-gray-900 dark:bg-white/10 text-white text-[11px] font-black uppercase tracking-widest rounded-lg hover:bg-gray-800 dark:hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                            >
                                {isVerifying ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    <Sparkles className="w-3 h-3 text-sage-400" />
                                )}
                                {isVerifying ? 'Checking...' : verifyLabel}
                            </button>
                        </div>
                    </div>

                </div>
            )}

            {statusMessage ? (
                <div role="status" className="flex items-center gap-2 px-1 text-[11px] font-bold text-sage-500 animate-in slide-in-from-top-1">
                    <Check className="w-3 h-3" />
                    <span>{statusMessage}</span>
                </div>
            ) : null}

            {status === 'error' && error && (
                <div role="alert" className="flex items-center gap-2 px-1 text-[11px] font-bold text-red-500/80 animate-in slide-in-from-top-1">
                    <XCircle className="w-3 h-3" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
};
