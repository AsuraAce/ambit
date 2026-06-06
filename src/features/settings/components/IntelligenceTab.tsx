import * as React from 'react';
import { FlaskConical, Cpu } from 'lucide-react';
import { AppSettings, type AiThinkingMode } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import {
    AI_MODELS,
    getSupportedThinkingModes,
    normalizeAiThinkingMode
} from '../../../constants/aiModels';
import { ApiKeyInput } from '../../../components/ui/ApiKeyInput';
import { useSettingsStore } from '../../../stores/settingsStore';
import {
    areDeveloperFeaturesEnabled,
    getEffectiveAiModel,
    getEffectiveAiThinkingMode
} from '../../../utils/settingsUtils';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

const THINKING_MODE_LABELS: Record<AiThinkingMode, string> = {
    default: 'Model Default',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    off: 'Off',
    dynamic: 'Dynamic',
};

export const IntelligenceTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const { addToast } = useToast();
    const { geminiApiKey, setGeminiApiKey } = useSettingsStore();
    const [localApiKey, setLocalApiKey] = React.useState(geminiApiKey || '');
    const [isVerifying, setIsVerifying] = React.useState(false);
    const [verificationStatus, setVerificationStatus] = React.useState<'idle' | 'success' | 'error'>('idle');
    const [verificationError, setVerificationError] = React.useState<string | null>(null);
    const developerFeaturesEnabled = areDeveloperFeaturesEnabled(settings);
    const effectiveAiModel = getEffectiveAiModel(settings);
    const effectiveAiThinkingMode = getEffectiveAiThinkingMode(settings);
    const supportedThinkingModes = getSupportedThinkingModes(effectiveAiModel);

    // Update local state if global key changes (e.g. from init)
    React.useEffect(() => {
        setLocalApiKey(geminiApiKey || '');
    }, [geminiApiKey]);

    const isEnvKey = !!process.env.API_KEY;

    const handleAIToggle = () => {
        const newValue = !settings.enableAI;
        setSettings(prev => ({ ...prev, enableAI: newValue }));
        addToast(newValue ? 'AI features enabled' : 'AI features disabled', 'success');
    };

    const handleApiKeyChange = (val: string) => {
        setLocalApiKey(val);
        setVerificationStatus('idle');
        setVerificationError(null);
    };

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const modelId = e.target.value;
        const model = AI_MODELS.find(m => m.id === modelId);
        setSettings(prev => ({
            ...prev,
            aiModel: modelId,
            aiThinkingMode: normalizeAiThinkingMode(modelId, prev.aiThinkingMode)
        }));
        setVerificationStatus('idle');
        setVerificationError(null);
        if (model) {
            addToast(`Switched to ${model.name}`, 'success');
        }
    };

    const handleThinkingModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const thinkingMode = e.target.value as AiThinkingMode;
        if (!supportedThinkingModes.includes(thinkingMode)) return;

        setSettings(prev => ({ ...prev, aiThinkingMode: thinkingMode }));
        addToast(`Thinking effort set to ${THINKING_MODE_LABELS[thinkingMode]}`, 'success');
    };

    const handleVerifyKey = async () => {
        if (!localApiKey) {
            addToast('Please enter an API key first', 'error');
            return;
        }

        setIsVerifying(true);
        setVerificationStatus('idle');
        setVerificationError(null);

        try {
            const { verifyApiKey } = await import('../../../services/geminiService');
            const result = await verifyApiKey(localApiKey, effectiveAiModel);
            if (result.valid) {
                setVerificationStatus('success');
                // Save to secure keyring on successful verification
                await setGeminiApiKey(localApiKey);
                addToast('API Key verified and saved securely', 'success');
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
                            <div className="text-sm text-gray-500">Unlocks natural language search, prompt analysis, and metadata recovery through on-demand Gemini requests.</div>
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
                            <ApiKeyInput
                                value={localApiKey}
                                onChange={handleApiKeyChange}
                                onVerify={handleVerifyKey}
                                isVerifying={isVerifying}
                                status={verificationStatus}
                                error={verificationError}
                                isEnvKey={isEnvKey}
                                onTestEnvKey={() => {
                                    const keyToTest = process.env.API_KEY || '';
                                    if (keyToTest) {
                                        (async () => {
                                            setIsVerifying(true);
                                            setVerificationStatus('idle');
                                            try {
                                                const { verifyApiKey } = await import('../../../services/geminiService');
                                                const result = await verifyApiKey(keyToTest, effectiveAiModel);
                                                if (result.valid) {
                                                    setVerificationStatus('success');
                                                    addToast('Environment API Key verified', 'success');
                                                } else {
                                                    setVerificationStatus('error');
                                                    setVerificationError(result.error || 'Verification failed');
                                                }
                                            } catch (e) {
                                                setVerificationStatus('error');
                                                setVerificationError(e instanceof Error ? e.message : 'Unknown error');
                                            } finally {
                                                setIsVerifying(false);
                                            }
                                        })();
                                    }
                                }}
                            />

                            {developerFeaturesEnabled && (
                                <div className="pt-2 space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <div>
                                        <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                                            <Cpu className="w-4 h-4 text-gray-400" /> AI Model (Dev Mode)
                                        </label>
                                        <select
                                            value={effectiveAiModel}
                                            onChange={handleModelChange}
                                            className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 transition-colors"
                                        >
                                            {AI_MODELS.map(model => (
                                                <option key={model.id} value={model.id} className="dark:bg-sage-900">
                                                    {model.name}
                                                    {model.isExperimental ? ' (Preview)' : ''}
                                                    {model.isLegacy ? ' (Legacy)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                            {AI_MODELS.find(m => m.id === effectiveAiModel)?.description}
                                        </p>
                                    </div>

                                    <div>
                                        <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2">
                                            Thinking Effort (Dev Mode)
                                        </label>
                                        <select
                                            value={effectiveAiThinkingMode}
                                            onChange={handleThinkingModeChange}
                                            className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 transition-colors"
                                        >
                                            {supportedThinkingModes.map(mode => (
                                                <option key={mode} value={mode} className="dark:bg-sage-900">
                                                    {THINKING_MODE_LABELS[mode]}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                            Changes the reasoning effort used by Ambit AI requests so response quality and speed can be compared.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <p className="text-xs text-gray-500 mt-2">
                                Use your own Gemini API key. Your key is stored locally in the OS keyring, and requests are sent only when you verify the key or run an AI feature.
                            </p>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
});
