import * as React from 'react';
import { useState, useEffect } from 'react';
import { Folder, DatabaseZap, Palette, FlaskConical } from 'lucide-react';
import { AppSettings } from '../../../types';
import { FoldersTab, InvokeAITab, A1111Tab, ComfyUITab } from './';
import type { ImportResult } from '../../../services/importService';

interface ConnectionsTabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    initialSubTab?: 'folders' | 'invokeai' | 'a1111' | 'comfyui';
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>;
    onInvokeSync?: () => Promise<void>; // Trigger InvokeAI database sync
    onClose?: () => void;
}

type ConnectionSubTab = 'folders' | 'invokeai' | 'a1111' | 'comfyui';

export const ConnectionsTab: React.FC<ConnectionsTabProps> = ({
    settings,
    setSettings,
    initialSubTab = 'folders',
    onScanFolder,
    onInvokeSync,
    onClose
}) => {
    const [activeTab, setActiveTab] = useState<ConnectionSubTab>(initialSubTab);

    // Sync active tab if initialSubTab changes (e.g. deep linking)
    useEffect(() => {
        if (initialSubTab) {
            setActiveTab(initialSubTab);
        }
    }, [initialSubTab]);

    const tabs: { id: ConnectionSubTab; label: string; icon: React.ReactNode }[] = [
        { id: 'folders', label: 'Folders', icon: <Folder className="w-4 h-4" /> },
        { id: 'invokeai', label: 'InvokeAI', icon: <DatabaseZap className="w-4 h-4" /> },
        { id: 'a1111', label: 'SD WebUI', icon: <Palette className="w-4 h-4" /> },
        { id: 'comfyui', label: 'ComfyUI', icon: <FlaskConical className="w-4 h-4" /> },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Sub Tabs Navigation */}
            <div className="flex p-1 bg-gray-100 dark:bg-white/5 rounded-xl overflow-x-auto custom-scrollbar">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 min-w-[100px] py-2 px-3 text-xs font-bold rounded-lg transition-all capitalize flex items-center justify-center gap-2 ${activeTab === tab.id
                            ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                    >
                        {tab.icon}
                        <span className="truncate">{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="min-h-[400px]">
                {activeTab === 'folders' && (
                    <FoldersTab
                        settings={settings}
                        setSettings={setSettings}
                        onScanFolder={onScanFolder}
                        onInvokeSync={onInvokeSync}
                    />
                )}
                {activeTab === 'invokeai' && (
                    <InvokeAITab
                        settings={settings}
                        setSettings={setSettings}
                    />
                )}
                {activeTab === 'a1111' && (
                    <A1111Tab
                        settings={settings}
                        setSettings={setSettings}
                        onClose={onClose || (() => { })}
                    />
                )}
                {activeTab === 'comfyui' && (
                    <ComfyUITab
                        settings={settings}
                        setSettings={setSettings}
                    />
                )}
            </div>
        </div>
    );
};
