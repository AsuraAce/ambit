
import * as React from 'react';
import { useState } from 'react';
import { Database, Zap, Loader2, BrainCircuit, Undo2, Save, Wrench, RefreshCw } from 'lucide-react';
import { APP_NAME } from '../../../constants/app';
import { generateStressTestData } from '../../../utils/dev/dataGenerator';
import { useLibraryContext } from '../../../hooks/useLibraryContext';
import { useSettingsStore } from '../../../stores/settingsStore';
import { commands } from '../../../bindings';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '../../../hooks/useToast';
import { useLibraryStore } from '../../../stores/libraryStore';
import { AI_PROMPTS, AIPromptKey } from '../../../constants/aiPrompts';
import { cn } from '../../../utils/cn';

type DevTabId = 'prompts' | 'tools';

export const DevTab: React.FC = () => {
    const { fetchData } = useLibraryContext();
    const { settings, setSettings } = useSettingsStore();
    const { addToast } = useToast();

    const [activeTab, setActiveTab] = useState<DevTabId>('prompts');

    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [targetCount, setTargetCount] = useState(10000);

    // Prompt Editing State
    const [openPrompt, setOpenPrompt] = useState<AIPromptKey | null>(null);
    const [editValue, setEditValue] = useState('');

    const handleStressTest = async () => {
        setIsGenerating(true);
        try {
            await generateStressTestData(targetCount, (current, total) => {
                setProgress({ current, total });
            });
            await fetchData(false);
        } finally {
            setIsGenerating(false);
            setProgress({ current: 0, total: 0 });
        }
    };

    // Prompt Handlers
    const handleEditPrompt = (key: AIPromptKey) => {
        const current = settings.systemPrompts?.[key] || AI_PROMPTS[key];
        setEditValue(current);
        setOpenPrompt(key);
    };

    const handleSavePrompt = (key: AIPromptKey) => {
        setSettings((prev) => ({
            ...prev,
            systemPrompts: {
                ...(prev.systemPrompts || {}),
                [key]: editValue
            }
        }));
        setOpenPrompt(null);
    };

    const handleResetPrompt = (key: AIPromptKey) => {
        setSettings((prev) => {
            const next = { ...(prev.systemPrompts || {}) };
            delete next[key];
            return { ...prev, systemPrompts: next };
        });
        if (openPrompt === key) {
            setEditValue(AI_PROMPTS[key]);
        }
    };

    const handleDevModeToggle = () => {
        setSettings((prev) => ({ ...prev, devMode: !prev.devMode }));
    };

    // Event listener for reset progress
    React.useEffect(() => {
        let unlisten: (() => void) | undefined;

        const setupListener = async () => {
            unlisten = await listen<string>('reset-progress', (event) => {
                addToast(event.payload, 'info');
            });
        };

        setupListener();

        return () => {
            if (unlisten) unlisten();
        };
    }, [addToast]);



    const tabs: { id: DevTabId; label: string; icon: React.ElementType }[] = [
        { id: 'prompts', label: 'AI Prompts', icon: BrainCircuit },
        { id: 'tools', label: 'Tools', icon: Wrench },
    ];

    return (
        <>
            <div className="h-full flex flex-col pt-2 animate-in fade-in slide-in-from-bottom-2 duration-300">

                {/* Tab Navigation - Fixed Header */}
                <div className="shrink-0 px-8 pb-4">
                    <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-zinc-800/50 rounded-lg">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-bold transition-all",
                                        isActive
                                            ? "bg-white dark:bg-zinc-700 text-amethyst-600 dark:text-amethyst-400 shadow-sm"
                                            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-white/5"
                                    )}
                                >
                                    <Icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-8 pb-8 space-y-6">
                    {/* System Prompts Section */}
                    {activeTab === 'prompts' && (
                        <section className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex items-start gap-3 p-4 bg-amethyst-50 dark:bg-amethyst-500/10 border border-amethyst-200 dark:border-amethyst-500/20 rounded-xl">
                                <BrainCircuit className="w-5 h-5 text-amethyst-600 dark:text-amethyst-400 mt-0.5 shrink-0" />
                                <div>
                                    <h4 className="text-sm font-bold text-amethyst-900 dark:text-amethyst-400">System Prompt Overrides</h4>
                                    <p className="text-xs text-amethyst-800/70 dark:text-amethyst-400/70 mt-1 leading-relaxed">
                                        Customize the internal instructions sent to the AI models.
                                        Changes here apply immediately. "Reset to Default" removes your override.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                {(Object.keys(AI_PROMPTS) as AIPromptKey[]).map((key) => {
                                    const isOverridden = !!settings.systemPrompts?.[key];
                                    const isEditing = openPrompt === key;

                                    return (
                                        <div key={key} className={cn(
                                            "bg-white dark:bg-zinc-900 border rounded-xl overflow-hidden transition-all",
                                            isOverridden ? 'border-amber-500/30 ring-1 ring-amber-500/20 shadow-sm' : 'border-gray-200 dark:border-white/5'
                                        )}>
                                            <div className="px-4 py-3 flex items-center justify-between bg-gray-50/50 dark:bg-white/[0.02] border-b border-gray-100 dark:border-white/5">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-xs font-bold font-mono text-gray-500 bg-gray-200 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                                        {key}
                                                    </div>
                                                    {isOverridden && (
                                                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                            <Wrench className="w-3 h-3" /> Modified
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex gap-2">
                                                    {isOverridden && (
                                                        <button
                                                            onClick={() => handleResetPrompt(key)}
                                                            className="p-1.5 text-gray-400 hover:text-rose-500 transition-colors rounded hover:bg-rose-50 dark:hover:bg-rose-900/20"
                                                            title="Reset to Default"
                                                        >
                                                            <Undo2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    {!isEditing && (
                                                        <button
                                                            onClick={() => handleEditPrompt(key)}
                                                            className="text-xs font-bold text-gray-600 dark:text-gray-300 hover:text-amethyst-600 dark:hover:text-amethyst-400 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                                                        >
                                                            Edit
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {isEditing ? (
                                                <div className="p-4 bg-gray-50 dark:bg-black/20 animate-in slide-in-from-top-2 duration-200">
                                                    <textarea
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        className="w-full h-96 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg p-3 text-xs font-mono text-gray-700 dark:text-gray-300 resize-y focus:outline-none focus:ring-2 focus:ring-amethyst-500/50"
                                                        autoFocus
                                                    />
                                                    <div className="flex justify-end gap-2 mt-3">
                                                        <button
                                                            onClick={() => setOpenPrompt(null)}
                                                            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={() => handleSavePrompt(key)}
                                                            className="px-4 py-1.5 bg-amethyst-600 hover:bg-amethyst-500 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg shadow-amethyst-500/20"
                                                        >
                                                            <Save className="w-3 h-3" /> Save Override
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-4 max-h-32 overflow-y-auto custom-scrollbar relative group">
                                                    <pre className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                                                        {settings.systemPrompts?.[key] || AI_PROMPTS[key]}
                                                    </pre>
                                                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white dark:from-zinc-900 to-transparent pointer-events-none" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {/* Tools Section */}
                    {activeTab === 'tools' && (
                        <section className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-6 bg-sage-500/10 border border-sage-500/20 rounded-2xl mb-6">
                                <div className="flex gap-4">
                                    <Database className="w-6 h-6 text-sage-500 shrink-0" />
                                    <div>
                                        <h5 className="text-sm font-bold text-sage-600 dark:text-sage-400 mb-1">Database Stress Testing</h5>
                                        <p className="text-xs text-sage-900/70 dark:text-sage-500/70 leading-relaxed">
                                            Generate dummy data to benchmark application performance.
                                            <br />
                                            <strong>Note:</strong> This increases database size significantly.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-4 mb-6">
                                <div
                                    onClick={handleDevModeToggle}
                                    className="flex items-center justify-between cursor-pointer group"
                                >
                                    <div>
                                        <div className="text-sm font-bold text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Developer Mode</div>
                                        <div className="text-xs text-gray-500">Enable detailed debug logs and system audits</div>
                                    </div>
                                    <button
                                        type="button"
                                        className={`w-10 h-6 rounded-full relative transition-colors ${settings.devMode ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${settings.devMode ? 'left-5' : 'left-1'}`} />
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-4 mb-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Console Log Level</div>
                                        <div className="text-xs text-gray-500">Filter console logs based on severity</div>
                                    </div>
                                    <select
                                        value={settings.logLevel || 'info'}
                                        onChange={(e) => setSettings(prev => ({ ...prev, logLevel: e.target.value as any }))}
                                        className="bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-bold font-mono text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-sage-500/50 cursor-pointer"
                                    >
                                        <option value="debug">DEBUG</option>
                                        <option value="info">INFO</option>
                                        <option value="warn">WARN</option>
                                        <option value="error">ERROR</option>
                                        <option value="none">NONE</option>
                                    </select>
                                </div>
                            </div>

                            {/* Metadata Diagnostics */}
                            <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Metadata Diagnostics</div>
                                        <div className="text-xs text-gray-500">Check raw metadata storage status</div>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const res = await invoke<{ total: number, with_raw: number, with_pv: number, v0: number, v1: number }>('get_metadata_stats');
                                                const msg = `Total: ${res.total}, With Raw: ${res.with_raw}, V0: ${res.v0}, V1: ${res.v1}`;
                                                addToast(msg, 'info');
                                                await navigator.clipboard.writeText(msg);
                                                addToast('Stats copied to clipboard', 'success');
                                            } catch (e: any) {
                                                addToast(`Error: ${e.message || e}`, 'error');
                                            }
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-gray-500/20"
                                    >
                                        Run Check
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 p-4 rounded-xl">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Target Image Count</label>
                                    <select
                                        value={targetCount}
                                        onChange={(e) => setTargetCount(Number(e.target.value))}
                                        className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sage-500/50 transition-all font-mono text-gray-900 dark:text-gray-100"
                                        disabled={isGenerating}
                                    >
                                        <option value={1000}>1,000 images</option>
                                        <option value={5000}>5,000 images</option>
                                        <option value={10000}>10,000 images</option>
                                        <option value={50000}>50,000 images</option>
                                        <option value={100000}>100,000 images</option>
                                    </select>
                                </div>

                                <button
                                    onClick={handleStressTest}
                                    disabled={isGenerating}
                                    className="w-full h-[43px] bg-sage-600 hover:bg-sage-500 disabled:bg-gray-300 dark:disabled:bg-white/5 text-white rounded-xl text-sm font-bold shadow-lg shadow-sage-500/20 flex items-center justify-center gap-2 transition-all transform active:scale-95 px-6"
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Generating {progress.current.toLocaleString()}...
                                        </>
                                    ) : (
                                        <>
                                            <Zap className="w-4 h-4 fill-white" />
                                            Start Stress Test
                                        </>
                                    )}
                                </button>
                            </div>
                        </section>
                    )}

                </div>
            </div>
        </>
    );
};
