import * as React from 'react';
import { useRef, useState } from 'react';
import { Monitor, Folder, Plus, Trash2, FolderSearch, RefreshCw } from 'lucide-react';
import { AppSettings, MonitoredFolder } from '../../../types';
import { scanResourceThumbnails } from '../../../services/importService';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useQueryClient } from '@tanstack/react-query';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const FoldersTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const [newFolderPath, setNewFolderPath] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [newResourcePath, setNewResourcePath] = useState('');
    const [isScanningResources, setIsScanningResources] = useState(false);
    const resourceInputRef = useRef<HTMLInputElement>(null);

    const handleAddFolder = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFolderPath.trim()) return;

        const newFolder: MonitoredFolder = {
            id: `folder_${Date.now()}`,
            path: newFolderPath,
            isActive: true,
            imageCount: 0
        };

        setSettings(prev => ({
            ...prev,
            monitoredFolders: [...prev.monitoredFolders, newFolder]
        }));
        setNewFolderPath('');
    };

    const handleAddResourceFolder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newResourcePath.trim()) return;

        const pathToAdd = newResourcePath.trim(); // Capture for async use

        setSettings(prev => ({
            ...prev,
            resourceFolders: [...(prev.resourceFolders || []), pathToAdd]
        }));
        setNewResourcePath('');

        // Trigger scan immediately for the new list
        setIsScanningResources(true);
        try {
            const currentList = [...(settings.resourceFolders || []), pathToAdd];
            await scanResourceThumbnails(currentList);
        } finally {
            setIsScanningResources(false);
        }
    };

    const handleScanNow = async () => {
        if (!settings.resourceFolders || settings.resourceFolders.length === 0) return;
        setIsScanningResources(true);
        try {
            const res = await scanResourceThumbnails(settings.resourceFolders);
            console.log("Scan complete", res);
        } finally {
            setIsScanningResources(false);
        }
    };



    const queryClient = useQueryClient();
    const { isPopulatingThumbnails } = useLibraryStore();


    const removeFolder = (id: string) => {
        setSettings(prev => ({
            ...prev,
            monitoredFolders: prev.monitoredFolders.filter(f => f.id !== id)
        }));
    };

    const handleRemoveResourceFolder = (path: string) => {
        setSettings(prev => ({
            ...prev,
            resourceFolders: (prev.resourceFolders || []).filter(p => p !== path)
        }));
    };

    const handleBrowse = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select Folder to Monitor'
            });

            if (selected && typeof selected === 'string') {
                const { normalizePath } = await import('../../../utils/pathUtils');
                setNewFolderPath(normalizePath(selected));
            }
        } catch (e) {
            console.warn('Native dialog failed, falling back to input', e);
            fileInputRef.current?.click();
        }
    };

    const handleBrowseResource = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select Model/Resource Folder'
            });

            if (selected && typeof selected === 'string') {
                const { normalizePath } = await import('../../../utils/pathUtils');
                setNewResourcePath(normalizePath(selected));
            }
        } catch (e) {
            console.warn('Native dialog failed, falling back to input', e);
            resourceInputRef.current?.click();
        }
    };

    const handleResourceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const relativePath = files[0].webkitRelativePath;
            const folderName = relativePath.split('/')[0] || 'Selected_Folder';
            // Use simulated path only if we can't get real path (native specific)
            setNewResourcePath(`D:/AI_Models/${folderName}`);
        }
        if (e.target) e.target.value = '';
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const relativePath = files[0].webkitRelativePath;
            const folderName = relativePath.split('/')[0] || 'Selected_Folder';
            setNewFolderPath(`D:/AI_Workflows/${folderName} (Simulated)`);
        }
        if (e.target) e.target.value = '';
    };

    return (
        <div className="space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* 1. Image Monitoring Section */}
            <div className="space-y-4">
                <div className="p-4 bg-sage-50 dark:bg-sage-500/10 border border-sage-200 dark:border-sage-500/20 rounded-xl text-sm text-sage-800 dark:text-sage-200 flex items-start gap-3">
                    <Monitor className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <strong className="block mb-1">Local Monitoring</strong>
                        Ambit watches these folders for new <span className="font-semibold">generated images</span> and adds them to your library.
                    </div>
                </div>

                <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden shadow-sm">
                    <div className="p-2 space-y-1">
                        {settings.monitoredFolders.map(folder => (
                            <div key={folder.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400">
                                        <Folder className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate">{folder.path}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{folder.imageCount} images</span>
                                    <button
                                        type="button"
                                        onClick={() => removeFolder(folder.id)}
                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {settings.monitoredFolders.length === 0 && (
                            <div className="text-sm text-gray-400 text-center py-8 italic">No image folders monitored.</div>
                        )}
                    </div>
                    <div className="border-t border-gray-200 dark:border-white/5 p-4 bg-gray-50/50 dark:bg-black/20">
                        <form onSubmit={handleAddFolder} className="flex gap-2">
                            <input
                                type="text"
                                value={newFolderPath}
                                onChange={(e) => setNewFolderPath(e.target.value)}
                                placeholder="e.g. D:/StableDiffusion/outputs"
                                className="flex-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-sage-500 outline-none text-gray-900 dark:text-white placeholder-gray-400"
                            />
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                className="hidden"
                                {...({ webkitdirectory: "", directory: "" } as any)}
                            />
                            <button
                                type="button"
                                onClick={handleBrowse}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
                                title="Browse"
                            >
                                <FolderSearch className="w-4 h-4" />
                            </button>
                            <button
                                type="submit"
                                disabled={!newFolderPath.trim()}
                                className="px-4 py-2 bg-sage-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg hover:bg-sage-500 transition-colors font-medium text-sm flex items-center gap-1"
                            >
                                <Plus className="w-4 h-4" /> Add
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* 2. Resource Discovery Section */}
            <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-white/5">
                <div className="p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl text-sm text-blue-800 dark:text-blue-200 flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <FolderSearch className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div>
                            <strong className="block mb-1">Resource Discovery</strong>
                            Add your Model/LoRA folders here. Ambit will scan them for thumbnails (<span className="font-mono text-xs">.jpg, .png, .webp</span>).
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {settings.resourceFolders && settings.resourceFolders.length > 0 && (
                            <button
                                type="button"
                                onClick={handleScanNow}
                                disabled={isScanningResources || isPopulatingThumbnails}
                                className={`flex items-center gap-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors ${isScanningResources || isPopulatingThumbnails ? 'opacity-70 cursor-wait' : ''}`}
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isScanningResources ? 'animate-spin' : ''}`} />
                                {isScanningResources ? 'Scanning...' : 'Scan Now'}
                            </button>
                        )}
                    </div>
                </div>

                <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden shadow-sm">
                    <div className="p-2 space-y-1">
                        {(settings.resourceFolders || []).map((path, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400">
                                        <Folder className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate">{path}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveResourceFolder(path)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                        {(!settings.resourceFolders || settings.resourceFolders.length === 0) && (
                            <div className="text-sm text-gray-400 text-center py-8 italic">No resource folders added.</div>
                        )}
                    </div>
                    <div className="border-t border-gray-200 dark:border-white/5 p-4 bg-gray-50/50 dark:bg-black/20">
                        <form onSubmit={handleAddResourceFolder} className="flex gap-2">
                            <input
                                type="text"
                                value={newResourcePath}
                                onChange={(e) => setNewResourcePath(e.target.value)}
                                placeholder="e.g. D:/StableDiffusion/models/Lora"
                                className="flex-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-sage-500 outline-none text-gray-900 dark:text-white placeholder-gray-400"
                            />
                            <input
                                type="file"
                                ref={resourceInputRef}
                                onChange={handleResourceFileSelect}
                                className="hidden"
                                {...({ webkitdirectory: "", directory: "" } as any)}
                            />
                            <button
                                type="button"
                                onClick={handleBrowseResource}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
                                title="Browse"
                            >
                                <FolderSearch className="w-4 h-4" />
                            </button>
                            <button
                                type="submit"
                                disabled={!newResourcePath.trim() || isScanningResources}
                                className="px-4 py-2 bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium text-sm flex items-center gap-1"
                            >
                                {isScanningResources ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                {isScanningResources ? 'Scanning...' : 'Add Path'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
});
