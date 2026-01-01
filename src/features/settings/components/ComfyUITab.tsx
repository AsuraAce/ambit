import * as React from 'react';
import { useState } from 'react';
import { Workflow, Folder, Info, FolderSearch, Loader2, CheckCircle2, XCircle, Plus, FolderOpen } from 'lucide-react';
import { AppSettings, GeneratorTool } from '../../../types';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const ComfyUITab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isScanning, setIsScanning] = useState(false);

    const handleLinkFolder = async () => {
        if (!settings.comfyUiPath) return;

        // Check if already linked
        const normalizedPath = settings.comfyUiPath.replace(/\\/g, '/');
        const exists = settings.monitoredFolders.some(f => f.path.replace(/\\/g, '/') === normalizedPath);

        if (exists) {
            setTestResult({ success: true, message: "Folder is already being monitored!" });
            return;
        }

        setTestResult(null);
        setIsScanning(true);

        try {
            // Validate path exists using Tauri fs or just assume valid if selected via dialog
            // We'll add it directly as a monitored folder

            const newFolder = {
                id: `comfyui_${Date.now()}`,
                path: settings.comfyUiPath,
                isActive: true,
                imageCount: 0, // Will be updated by scanner
                variant: GeneratorTool.COMFYUI
            };

            setSettings(prev => ({
                ...prev,
                monitoredFolders: [...prev.monitoredFolders, newFolder]
            }));

            setTestResult({ success: true, message: "Successfully linked ComfyUI output folder!" });
        } catch (e) {
            console.error(e);
            setTestResult({ success: false, message: "Failed to link folder." });
        } finally {
            setIsScanning(false);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="px-1">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                    ComfyUI Integration
                </h3>
                <p className="text-sm text-gray-500">
                    Connect your ComfyUI or SwarmUI installation.
                </p>
            </div>

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                <h4 className="text-[10px] font-black text-white px-4 py-2 bg-indigo-600 rounded-lg inline-flex items-center gap-3 mb-6 uppercase tracking-widest shadow-lg shadow-indigo-500/20">
                    <Workflow className="w-4 h-4" /> Output Configuration
                </h4>

                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                        <div className="relative">
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 px-1">
                                Output Folder Path
                            </label>
                            <div className="flex gap-2">
                                <div className="flex-1 relative group">
                                    <input
                                        type="text"
                                        value={settings.comfyUiPath || ''}
                                        onChange={(e) => setSettings(prev => ({ ...prev, comfyUiPath: e.target.value }))}
                                        placeholder="e.g. C:\\ComfyUI\\output"
                                        className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none text-gray-900 dark:text-white font-mono transition-all"
                                    />
                                    <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                                </div>
                                <button
                                    type="button"
                                    title="Browse"
                                    onClick={async () => {
                                        try {
                                            const { open } = await import('@tauri-apps/plugin-dialog');
                                            const selected = await open({ directory: true, multiple: false, title: 'Select ComfyUI Output Folder' });
                                            if (selected && typeof selected === 'string') {
                                                const { normalizePath } = await import('../../../utils/pathUtils');
                                                setSettings(prev => ({ ...prev, comfyUiPath: normalizePath(selected) }));
                                            }
                                        } catch (e) { console.error(e); }
                                    }}
                                    className="aspect-square h-[42px] flex items-center justify-center bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all"
                                >
                                    <FolderOpen className="w-5 h-5" />
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-3 flex items-center gap-1.5 opacity-80 px-1">
                                <Info className="w-3 h-3" /> Select the 'output' folder where ComfyUI saves generated images.
                            </p>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-black/5 dark:border-white/5 flex flex-col gap-6">
                        <div className="flex items-center justify-between">
                            <button
                                onClick={handleLinkFolder}
                                disabled={isScanning || !settings.comfyUiPath}
                                className={`px-8 py-3 rounded-xl text-sm font-black tracking-wide transition-all flex items-center gap-2.5 ${!settings.comfyUiPath
                                    ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-500/20 active:scale-95'
                                    }`}
                            >
                                {isScanning ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Linking...
                                    </>
                                ) : (
                                    <>
                                        <Plus className="w-4 h-4" />
                                        Link Output Folder
                                    </>
                                )}
                            </button>

                            {testResult && (
                                <div className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in slide-in-from-right-2 duration-300 ${testResult.success
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                    }`}>
                                    {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                    {testResult.message}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
});
