import * as React from 'react';
import { FlaskConical, Key, Check, XCircle, Loader2, Cpu } from 'lucide-react';
import { AppSettings } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import { verifyApiKey } from '../../../services/geminiService';
import { AI_MODELS, DEFAULT_AI_MODEL } from '../../../constants/aiModels';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const IntelligenceTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const { addToast } = useToast();
    const [isVerifying, setIsVerifying] = React.useState(false);
    const [verificationStatus, setVerificationStatus] = React.useState<'idle' | 'success' | 'error'>('idle');
    const [verificationError, setVerificationError] = React.useState<string | null>(null);

    const handleAIToggle = () => {
        const newValue = !settings.enableAI;
        setSettings(prev => ({ ...prev, enableAI: newValue }));
        addToast(newValue ? 'AI features enabled' : 'AI features disabled', 'success');
    };

    const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSettings(prev => ({ ...prev, googleGeminiApiKey: e.target.value }));
        setVerificationStatus('idle');
        setVerificationError(null);
    };

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const modelId = e.target.value;
        const model = AI_MODELS.find(m => m.id === modelId);
        setSettings(prev => ({ ...prev, aiModel: modelId }));
        setVerificationStatus('idle');
        setVerificationError(null);
        if (model) {
            addToast(`Switched to ${model.name}`, 'success');
        }
    };

    const handleVerifyKey = async () => {
        if (!settings.googleGeminiApiKey) {
            addToast('Please enter an API key first', 'error');
            return;
        }

        setIsVerifying(true);
        setVerificationStatus('idle');
        setVerificationError(null);

        try {
            const result = await verifyApiKey(settings.googleGeminiApiKey, settings.aiModel || DEFAULT_AI_MODEL);
            if (result.valid) {
                setVerificationStatus('success');
                addToast('API Key verified successfully', 'success');
            } else {
                setVerificationStatus('error');
                setVerificationError(result.error || 'Verification failed');
                addToast(result.error || 'Verification failed', 'error');
            }
        } catch (error) {
            setVerificationStatus('error');
            const msg = error instanceof Error ? error.message : 'Unknown error';
            setVerificationError(msg);
            addToast(msg, 'error');
        } finally {
            setIsVerifying(false);
        }
    };

    return (
        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-sage-500 uppercase tracking-wider mb-6 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" /> Ambit Intelligence
                </h4>

                <div className="space-y-6">
                    <div
                        onClick={handleAIToggle}
                        className="flex items-center justify-between cursor-pointer group"
                    >
                        <div>
                            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Enable AI Features</div>
                            <div className="text-sm text-gray-500">Unlocks natural language search, prompt analysis, and metadata recovery.</div>
                        </div>
                        <button
                            type="button"
                            className={`w-12 h-7 rounded-full relative transition-colors ${settings.enableAI ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                        >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.enableAI ? 'left-6' : 'left-1'}`} />
                        </button>
                    </div>

                    {settings.enableAI && (
                        <div className="animate-in fade-in slide-in-from-top-2 space-y-4">
                            <div>
                                <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                                    <Key className="w-4 h-4 text-gray-400" /> Google Gemini API Key
                                </label>
                                <div className="relative group">
                                    <input
                                        type="password"
                                        value={settings.googleGeminiApiKey || ''}
                                        onChange={handleApiKeyChange}
                                        placeholder="AIzaSy..."
                                        className={`w-full bg-gray-50 dark:bg-black/20 border ${verificationStatus === 'success' ? 'border-sage-500/50' : verificationStatus === 'error' ? 'border-red-500/50' : 'border-gray-200 dark:border-white/10'} rounded-xl p-3 pr-24 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 font-mono transition-colors`}
                                    />
                                    <div className="absolute right-2 top-1.5 flex items-center gap-2">
                                        {verificationStatus === 'success' && (
                                            <Check className="w-4 h-4 text-sage-500 animate-in fade-in zoom-in" />
                                        )}
                                        {verificationStatus === 'error' && (
                                            <XCircle className="w-4 h-4 text-red-500 animate-in fade-in zoom-in" />
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleVerifyKey}
                                            disabled={isVerifying || !settings.googleGeminiApiKey}
                                            className="px-3 py-1.5 bg-gray-900 dark:bg-white/10 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-gray-800 dark:hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                        >
                                            {isVerifying ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : null}
                                            {isVerifying ? 'Testing...' : 'Test Key'}
                                        </button>
                                    </div>
                                </div>
                                {verificationError && (
                                    <p className="text-[10px] text-red-500 mt-1.5 ml-1 animate-in slide-in-from-top-1">
                                        {verificationError}
                                    </p>
                                )}
                            </div>

                            {settings.devMode && (
                                <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                                    <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                                        <Cpu className="w-4 h-4 text-gray-400" /> AI Model (Dev Mode)
                                    </label>
                                    <select
                                        value={settings.aiModel || DEFAULT_AI_MODEL}
                                        onChange={handleModelChange}
                                        className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 transition-colors"
                                    >
                                        {AI_MODELS.map(model => (
                                            <option key={model.id} value={model.id} className="dark:bg-sage-900">
                                                {model.name} {model.isExperimental ? '(Preview)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                        {AI_MODELS.find(m => m.id === (settings.aiModel || DEFAULT_AI_MODEL))?.description}
                                    </p>
                                </div>
                            )}

                            <p className="text-xs text-gray-500 mt-2">
                                Your key is stored locally. Get one at{' '}
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            const { open } = await import('@tauri-apps/plugin-shell');
                                            await open('https://aistudio.google.com/app/apikey');
                                        } catch (e) {
                                            console.error('Failed to open URL:', e);
                                            // Fallback just in case
                                            window.open('https://aistudio.google.com/app/apikey', '_blank');
                                        }
                                    }}
                                    className="text-sage-600 hover:underline"
                                >
                                    Google AI Studio
                                </button>.
                            </p>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
});
