import * as React from 'react';
import { useState } from 'react';
import { Shield } from 'lucide-react';
import { AppSettings } from '../../../types';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const PrivacyTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const [keywordInput, setKeywordInput] = useState(settings.maskedKeywords.join(', '));

    const handleKeywordsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setKeywordInput(e.target.value);
        const split = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
        setSettings(prev => ({ ...prev, maskedKeywords: split }));
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
                                        onChange={() => setSettings(prev => ({ ...prev, maskingMode: 'blur' }))}
                                        className="accent-sage-600"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Blur Content</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="maskingMode"
                                        checked={settings.maskingMode === 'hide'}
                                        onChange={() => setSettings(prev => ({ ...prev, maskingMode: 'hide' }))}
                                        className="accent-sage-600"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Hide Completely</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2">Masked Keywords</label>
                        <textarea
                            value={keywordInput}
                            onChange={handleKeywordsChange}
                            placeholder="nsfw, blood, gore..."
                            className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none min-h-[100px] text-gray-700 dark:text-gray-300"
                        />
                        <p className="text-xs text-gray-500 mt-2">Images with prompts containing these words will be masked or hidden.</p>
                    </div>
                </div>
            </section>
        </div>
    );
});
