import * as React from 'react';
import { FlaskConical, Key } from 'lucide-react';
import { AppSettings } from '../../../types';
import { useToast } from '../../../hooks/useToast';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const IntelligenceTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const { addToast } = useToast();

    const handleAIToggle = () => {
        const newValue = !settings.enableAI;
        setSettings(prev => ({ ...prev, enableAI: newValue }));
        addToast(newValue ? 'AI features enabled' : 'AI features disabled', 'success');
    };

    const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSettings(prev => ({ ...prev, googleGeminiApiKey: e.target.value }));
    };

    const handleApiKeyBlur = () => {
        if (settings.googleGeminiApiKey) {
            addToast('API key saved', 'success');
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
                        <div className="animate-in fade-in slide-in-from-top-2">
                            <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                                <Key className="w-4 h-4 text-gray-400" /> Google Gemini API Key
                            </label>
                            <input
                                type="password"
                                value={settings.googleGeminiApiKey || ''}
                                onChange={handleApiKeyChange}
                                onBlur={handleApiKeyBlur}
                                placeholder="AIzaSy..."
                                className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 font-mono"
                            />
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
