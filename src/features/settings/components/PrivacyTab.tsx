import * as React from 'react';
import { useState } from 'react';
import { Loader2, Plus, RotateCcw, Shield, ShieldAlert, X } from 'lucide-react';
import { AppSettings } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import { useSettingsStore } from '../../../stores/settingsStore';
import { settingsPersistenceCoordinator } from '../../../utils/settingsPersistenceCoordinator';

type PrivacySettingsField = 'maskedKeywords' | 'maskingMode';

const privacyValuesEqual = <Field extends PrivacySettingsField>(
    field: Field,
    left: AppSettings[Field],
    right: AppSettings[Field]
): boolean => {
    if (field !== 'maskedKeywords') return left === right;
    const leftKeywords = left as AppSettings['maskedKeywords'];
    const rightKeywords = right as AppSettings['maskedKeywords'];
    return leftKeywords.length === rightKeywords.length
        && leftKeywords.every((keyword, index) => keyword === rightKeywords[index]);
};

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const PrivacyTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const [keywordInput, setKeywordInput] = useState('');
    const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);
    const { addToast } = useToast();
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const setPrivacyEnabled = useSettingsStore(state => state.setPrivacyEnabled);
    const flushSettings = useSettingsStore(state => state.flushSettings);
    const rollbackSettings = useSettingsStore(state => state.rollbackSettings);
    const privacyMaskIndexStatus = useSettingsStore(state => state.privacyMaskIndexStatus);
    const privacyMaskIndexError = useSettingsStore(state => state.privacyMaskIndexError);
    const retryPrivacyMaskIndex = useSettingsStore(state => state.retryPrivacyMaskIndex);
    const mountedRef = React.useRef(true);
    const operationGenerationsRef = React.useRef<Record<PrivacySettingsField, number>>({
        maskedKeywords: 0,
        maskingMode: 0,
    });

    React.useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    const handlePrivacyToggle = () => {
        const nextValue = !privacyEnabled;
        setPrivacyEnabled(nextValue);
        addToast(nextValue ? 'Privacy mode enabled for this session' : 'Privacy mode disabled for this session', 'success');
    };

    const persistPrivacyChange = async <Field extends PrivacySettingsField>(
        field: Field,
        optimisticValue: AppSettings[Field],
        previousValue: AppSettings[Field],
        successMessage: string,
        errorMessage: string
    ): Promise<boolean> => {
        if (isSavingPrivacy || !settingsPersistenceCoordinator.isAccepting()) return false;

        const generation = ++operationGenerationsRef.current[field];
        const ownsOperation = () => operationGenerationsRef.current[field] === generation;
        return settingsPersistenceCoordinator.run(async (permit) => {
            setIsSavingPrivacy(true);
            setSettings(prev => ({ ...prev, [field]: optimisticValue }));
            try {
                await flushSettings();
                if (mountedRef.current && ownsOperation()) {
                    addToast(successMessage, 'success');
                    return true;
                }
                return false;
            } catch (error) {
                console.error('[Privacy] Failed to persist privacy settings', error);
                let didRollback = false;
                const restoredSettings = rollbackSettings(permit, prev => {
                    if (!ownsOperation()
                        || !privacyValuesEqual(field, prev[field], optimisticValue)) {
                        return prev;
                    }
                    didRollback = true;
                    return { ...prev, [field]: previousValue };
                });
                if (didRollback && restoredSettings) {
                    try {
                        await flushSettings(restoredSettings);
                    } catch (rollbackError) {
                        console.error('[Privacy] Failed to persist privacy settings rollback', rollbackError);
                    }
                    if (mountedRef.current) addToast(errorMessage, 'error');
                }
                return false;
            } finally {
                if (mountedRef.current) setIsSavingPrivacy(false);
            }
        });
    };

    const handleMaskingModeChange = async (mode: 'blur' | 'hide') => {
        const previousMode = settings.maskingMode;
        await persistPrivacyChange(
            'maskingMode',
            mode,
            previousMode,
            `Masking mode set to ${mode}`,
            'Failed to save masking mode'
        );
    };

    const handleAddKeyword = async () => {
        const trimmed = keywordInput.trim().toLowerCase();
        if (!trimmed) return;

        if (settings.maskedKeywords.includes(trimmed)) {
            addToast('Keyword already exists', 'warning');
            return;
        }

        const previousKeywords = [...settings.maskedKeywords];
        const nextKeywords = [...previousKeywords, trimmed];
        const saved = await persistPrivacyChange(
            'maskedKeywords',
            nextKeywords,
            previousKeywords,
            `Added "${trimmed}" to masked keywords`,
            `Failed to save "${trimmed}" as a masked keyword`
        );
        if (saved) setKeywordInput('');
    };

    const handleRemoveKeyword = async (keyword: string) => {
        const previousKeywords = [...settings.maskedKeywords];
        const nextKeywords = previousKeywords.filter(k => k !== keyword);
        await persistPrivacyChange(
            'maskedKeywords',
            nextKeywords,
            previousKeywords,
            `Removed "${keyword}" from masked keywords`,
            `Failed to remove "${keyword}" from masked keywords`
        );
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void handleAddKeyword();
        }
    };

    return (
        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <button
                    type="button"
                    role="switch"
                    aria-checked={privacyEnabled}
                    aria-labelledby="privacy-mode-label"
                    aria-describedby="privacy-mode-description"
                    onClick={handlePrivacyToggle}
                    className="w-full flex items-center justify-between gap-6 text-left cursor-pointer group"
                >
                    <div>
                        <div id="privacy-mode-label" className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Privacy Mode</div>
                        <div id="privacy-mode-description" className="text-sm text-gray-500">Privacy masking is enabled by default every time Ambit starts. Turning it off here only affects the current session.</div>
                    </div>
                    <span
                        aria-hidden="true"
                        className={`w-12 h-7 rounded-full relative transition-colors ${privacyEnabled ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                    >
                        <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${privacyEnabled ? 'left-6' : 'left-1'}`} />
                    </span>
                </button>
            </section>

            {privacyEnabled && privacyMaskIndexStatus !== 'ready' && (
                <section
                    className={`border rounded-xl p-4 ${privacyMaskIndexStatus === 'failed'
                        ? 'bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20'
                        : 'bg-sage-50 border-sage-200 dark:bg-sage-500/10 dark:border-sage-500/20'}`}
                    role={privacyMaskIndexStatus === 'failed' ? 'alert' : 'status'}
                    aria-live="polite"
                >
                    <div className="flex items-start gap-3">
                        {privacyMaskIndexStatus === 'failed'
                            ? <ShieldAlert className="w-5 h-5 mt-0.5 text-rose-500 shrink-0" />
                            : <Loader2 className="w-5 h-5 mt-0.5 text-sage-600 animate-spin shrink-0" />}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900 dark:text-white">
                                {privacyMaskIndexStatus === 'failed'
                                    ? 'Privacy protection could not be prepared'
                                    : 'Preparing privacy protection'}
                            </p>
                            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                                {privacyMaskIndexStatus === 'failed'
                                    ? 'Library content remains hidden until the refresh succeeds or Privacy Mode is disabled for this session.'
                                    : 'Your library will be available when the latest masking rules are ready.'}
                            </p>
                            {privacyMaskIndexStatus === 'failed' && privacyMaskIndexError && (
                                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 break-words">{privacyMaskIndexError}</p>
                            )}
                        </div>
                        {privacyMaskIndexStatus === 'failed' && (
                            <button
                                type="button"
                                onClick={retryPrivacyMaskIndex}
                                className="inline-flex items-center gap-1.5 px-3 py-2 bg-sage-600 hover:bg-sage-500 text-white rounded-lg text-xs font-bold"
                            >
                                <RotateCcw className="w-3.5 h-3.5" /> Retry
                            </button>
                        )}
                    </div>
                </section>
            )}

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
                                        onChange={() => { void handleMaskingModeChange('blur'); }}
                                        disabled={isSavingPrivacy}
                                        className="accent-sage-600"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Blur Content</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="maskingMode"
                                        checked={settings.maskingMode === 'hide'}
                                        onChange={() => { void handleMaskingModeChange('hide'); }}
                                        disabled={isSavingPrivacy}
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
                                disabled={isSavingPrivacy}
                                placeholder="Type keyword and press Enter..."
                                className="flex-1 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300"
                            />
                            <button
                                type="button"
                                onClick={() => { void handleAddKeyword(); }}
                                disabled={!keywordInput.trim() || isSavingPrivacy}
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
                                            onClick={() => { void handleRemoveKeyword(keyword); }}
                                            disabled={isSavingPrivacy}
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
