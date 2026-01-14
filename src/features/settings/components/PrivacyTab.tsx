import * as React from 'react';
import { useState } from 'react';
import { Shield, X, Plus } from 'lucide-react';
import { AppSettings } from '../../../types';
import { useToast } from '../../../hooks/useToast';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const PrivacyTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const [keywordInput, setKeywordInput] = useState('');
    const { addToast } = useToast();

    const handleMaskingModeChange = (mode: 'blur' | 'hide') => {
        setSettings(prev => ({ ...prev, maskingMode: mode }));
        addToast(`Masking mode set to ${mode}`, 'success');
    };

    const handleAddKeyword = () => {
        const trimmed = keywordInput.trim().toLowerCase();
        if (!trimmed) return;

        if (settings.maskedKeywords.includes(trimmed)) {
            addToast('Keyword already exists', 'warning');
            return;
        }

        setSettings(prev => ({
            ...prev,
            maskedKeywords: [...prev.maskedKeywords, trimmed]
        }));
        setKeywordInput('');
        addToast(`Added "${trimmed}" to masked keywords`, 'success');
    };

    const handleRemoveKeyword = (keyword: string) => {
        setSettings(prev => ({
            ...prev,
            maskedKeywords: prev.maskedKeywords.filter(k => k !== keyword)
        }));
        addToast(`Removed "${keyword}" from masked keywords`, 'success');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddKeyword();
        }
    };

    return (
        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Safety Filters</h4>

                <div className="space-y-6">
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-sage-50 dark:bg-white/10 rounded-lg text-sage-600 dark:text-sage-400">
                            <Shield className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                            <label className="text-sm font-bold text-gray-900 dark:text-white block mb-1">Masking Behavior</label>
                            <div className="flex gap-4 mt-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="maskingMode"
                                        checked={settings.maskingMode === 'blur'}
                                        onChange={() => handleMaskingModeChange('blur')}
                                        className="accent-sage-600"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Blur Content</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="maskingMode"
                                        checked={settings.maskingMode === 'hide'}
                                        onChange={() => handleMaskingModeChange('hide')}
                                        className="accent-sage-600"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Hide Completely</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2">Masked Keywords</label>
                        <p className="text-xs text-gray-500 mb-3">Images with prompts containing these words will be masked or hidden.</p>

                        {/* Chip Input */}
                        <div className="flex gap-2 mb-3">
                            <input
                                type="text"
                                value={keywordInput}
                                onChange={(e) => setKeywordInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type keyword and press Enter..."
                                className="flex-1 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300"
                            />
                            <button
                                type="button"
                                onClick={handleAddKeyword}
                                disabled={!keywordInput.trim()}
                                className="px-4 py-2.5 bg-sage-600 hover:bg-sage-500 disabled:bg-gray-200 dark:disabled:bg-white/10 disabled:cursor-not-allowed text-white disabled:text-gray-400 rounded-xl text-sm font-bold transition-colors flex items-center gap-1.5"
                            >
                                <Plus className="w-4 h-4" /> Add
                            </button>
                        </div>

                        {/* Keyword Chips */}
                        <div className="flex flex-wrap gap-2 min-h-[40px] p-3 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl">
                            {settings.maskedKeywords.length === 0 ? (
                                <span className="text-xs text-gray-400 italic">No keywords added yet</span>
                            ) : (
                                settings.maskedKeywords.map((keyword) => (
                                    <span
                                        key={keyword}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 rounded-full text-xs font-medium group"
                                    >
                                        {keyword}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveKeyword(keyword)}
                                            className="p-0.5 hover:bg-rose-200 dark:hover:bg-rose-500/30 rounded-full transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
});
