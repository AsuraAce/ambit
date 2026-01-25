import * as React from 'react';
import { useRef, useState } from 'react';
import { Monitor, Folder, Plus, Trash2, FolderSearch, RefreshCw } from 'lucide-react';
import { APP_NAME } from '../../../constants/app';
import { AppSettings, MonitoredFolder, GeneratorTool } from '../../../types';
import { scanResourceThumbnails } from '../../../services/importService';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useQueryClient } from '@tanstack/react-query';
import { commands } from '../../../bindings';
import { useToast } from '../../../hooks/useToast';
import { normalizePath } from '../../../utils/pathUtils';

// Helper to detect generator from path
const detectGeneratorVariant = (path: string): GeneratorTool => {
    const lower = path.toLowerCase();
    if (lower.includes('invokeai')) return GeneratorTool.INVOKEAI;
    if (lower.includes('comfyui') || lower.includes('comfy')) return GeneratorTool.COMFYUI;
    if (lower.includes('webui') || lower.includes('stable-diffusion-webui') || lower.includes('a1111')) return GeneratorTool.AUTOMATIC1111;
    if (lower.includes('sdnext') || lower.includes('sd.next')) return GeneratorTool.SDNEXT;
    if (lower.includes('forge')) return GeneratorTool.FORGE;
    if (lower.includes('anapnoe')) return GeneratorTool.ANAPNOE;
    return GeneratorTool.UNKNOWN;
};

// Helper for variant icons/badges
const getVariantIcon = (variant?: GeneratorTool) => {
    switch (variant) {
        case GeneratorTool.INVOKEAI:
            return <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">INVOKE</div>;
        case GeneratorTool.COMFYUI:
            return <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/30 text-blue-300 border border-blue-800/50">COMFY</div>;
        case GeneratorTool.AUTOMATIC1111:
            return <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-900/30 text-orange-300 border border-orange-800/50">A1111</div>;
        case GeneratorTool.SDNEXT:
            return <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-900/30 text-indigo-300 border border-indigo-800/50">SD.NEXT</div>;
        case GeneratorTool.FORGE:
            return <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-900/30 text-emerald-300 border border-emerald-800/50">FORGE</div>;
        case GeneratorTool.ANAPNOE:
            return <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-fuchsia-900/30 text-fuchsia-300 border border-fuchsia-800/50">ANAPNOE</div>;
        default:
            // Standard folder icon fallback (handled by caller usually, but strictly returning null here isn't great if used directly)
            return null;
    }
};

// Helper to get InvokeAI root path (strip /databases suffix if present)
const getInvokeRootPath = (path: string): string => {
    // invokeAiPath might be the databases folder or the root - normalize it
    return path.replace(/[\\/](databases)?[\\/]?$/i, '');
};

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<void>;
    onInvokeSync?: () => Promise<void>; // Trigger InvokeAI database sync for managed integration
}

export const FoldersTab: React.FC<TabProps> = React.memo(({ settings, setSettings, onScanFolder, onInvokeSync }) => {
    const [newFolderPath, setNewFolderPath] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { addToast } = useToast();
    const [scanningIds, setScanningIds] = useState<Set<string>>(new Set()); // Track scanning folders

    // Fetch counts logic extracted for reuse
    const fetchCounts = async () => {
        if (!settings.monitoredFolders.length && !settings.invokeAiPath) return;

        let hasUpdates = false;
        const updatedFolders = await Promise.all(settings.monitoredFolders.map(async (folder) => {
            try {
                // Determine Variant if unknown
                let variant = folder.variant;
                if (!variant || variant === GeneratorTool.UNKNOWN) {
                    variant = detectGeneratorVariant(folder.path);
                    if (variant !== folder.variant) hasUpdates = true;
                }

                const res = await commands.getImageCountForPathPrefix(folder.path);
                if (res.status === 'ok' && res.data !== folder.imageCount) {
                    hasUpdates = true;
                    return { ...folder, imageCount: res.data, variant };
                }
                if (variant !== folder.variant) {
                    return { ...folder, variant };
                }
            } catch (e) {
                console.error('Failed to get count for', folder.path, e);
            }
            return folder;
        }));

        if (hasUpdates) {
            setSettings(prev => ({ ...prev, monitoredFolders: updatedFolders }));
        }
    };

    // Fetch image counts on mount and when folders change
    React.useEffect(() => {
        fetchCounts();
    }, [settings.monitoredFolders.length]); // Only run on length change

    // Construct Combined List (Monitored + Managed Integrations)
    const combinedFolders = React.useMemo(() => {
        const list = [...settings.monitoredFolders];

        // Inject Managed InvokeAI Folder
        if (settings.invokeAiPath) {
            const invokeRoot = getInvokeRootPath(settings.invokeAiPath);
            const outputsPath = `${invokeRoot}/outputs/images`;
            const exists = list.some(f => f.path.startsWith(invokeRoot) || invokeRoot.startsWith(f.path));
            if (!exists) {
                list.unshift({
                    id: 'managed_invoke',
                    path: outputsPath,
                    pathRaw: outputsPath,
                    isActive: true,
                    imageCount: 0,
                    variant: GeneratorTool.INVOKEAI,
                    isManaged: true
                } as any);
            }
        }
        return list;
    }, [settings.monitoredFolders, settings.invokeAiPath]);


    const handleRescan = async (id: string, path: string, variant?: string, isManaged?: boolean) => {
        setScanningIds(prev => new Set(prev).add(id));
        try {
            // For managed InvokeAI integration, trigger database sync instead of folder scan
            if (isManaged && variant === GeneratorTool.INVOKEAI && onInvokeSync) {
                await onInvokeSync();
                addToast('InvokeAI database sync complete', 'success');
            } else if (onScanFolder) {
                await onScanFolder([{ path, variant }]);
                addToast(`Rescan complete for ${path}`, 'success');
            }
            await fetchCounts(); // Refresh counts
        } catch (e) {
            console.error(e);
            addToast(isManaged ? 'InvokeAI sync failed' : `Rescan failed for ${path}`, 'error');
        } finally {
            setScanningIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const [newResourcePath, setNewResourcePath] = useState('');
    const [isScanningResources, setIsScanningResources] = useState(false);
    const resourceInputRef = useRef<HTMLInputElement>(null);

    // Debounced auto-scan for newly added folders
    const pendingScansRef = useRef<{ path: string, variant?: string }[]>([]);
    const scanDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const queueFolderForScan = (path: string, variant?: string) => {
        pendingScansRef.current.push({ path, variant });

        // Clear existing timeout
        if (scanDebounceRef.current) {
            clearTimeout(scanDebounceRef.current);
        }

        // Set new debounce - 500ms to allow batch adding
        scanDebounceRef.current = setTimeout(async () => {
            if (pendingScansRef.current.length === 0 || !onScanFolder) return;

            const foldersToScan = [...pendingScansRef.current];
            pendingScansRef.current = [];

            try {
                await onScanFolder(foldersToScan);
                addToast(`Scanned ${foldersToScan.length} folder(s)`, 'success');
                await fetchCounts();
            } catch (e) {
                console.error('Auto-scan failed:', e);
                addToast('Folder scan failed', 'error');
            }
        }, 500);
    };

    const handleAddFolder = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFolderPath.trim()) return;

        const normalizedNew = normalizePath(newFolderPath);

        // Path-based Deduplication
        const existing = settings.monitoredFolders.find(f => normalizePath(f.path) === normalizedNew);
        if (existing) {
            addToast(`Folder is already monitored: ${existing.path}`, 'info');
            setNewFolderPath('');
            return;
        }

        const variant = detectGeneratorVariant(normalizedNew);

        const newFolder: MonitoredFolder = {
            id: `folder_${Date.now()}`,
            path: normalizedNew,
            isActive: true,
            imageCount: 0,
            variant: variant
        };

        setSettings(prev => ({
            ...prev,
            monitoredFolders: [...prev.monitoredFolders, newFolder]
        }));
        setNewFolderPath('');
        addToast(`Added folder: ${normalizedNew}`, 'success');

        // Queue for auto-scan
        queueFolderForScan(normalizedNew, variant);
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
        addToast(`Added resource folder: ${pathToAdd}`, 'success');

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
        addToast('Scanning resource folders...', 'info');
        try {
            const res = await scanResourceThumbnails(settings.resourceFolders);
            console.log("Scan complete", res);
            addToast('Resource scan complete', 'success');
        } catch (e) {
            console.error(e);
            addToast('Resource scan failed', 'error');
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
                        <strong className="block mb-1">Image Folders</strong>
                        Add folders containing AI-generated images. Use this for <span className="font-semibold">archived images</span> or specific output directories.
                    </div>
                </div>

                <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden shadow-sm">
                    <div className="p-2 space-y-1">
                        {combinedFolders.map(folder => (
                            <div key={folder.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    {/* Variant Icon / Badge */}
                                    <div className="flex-shrink-0 w-16 flex justify-center">
                                        {/* Auto-detect generic folder icon separately if variant is UNKNOWN/undefined */}
                                        {(!folder.variant || folder.variant === GeneratorTool.UNKNOWN) ? (
                                            <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400">
                                                <Folder className="w-4 h-4" />
                                            </div>
                                        ) : getVariantIcon(folder.variant)}
                                    </div>

                                    <div className="flex flex-col min-w-0 flex-1">
                                        <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate">
                                            {(folder as any).isManaged ? (folder as any).pathRaw : folder.path}
                                        </span>
                                        {/* Consistent Subtitle for EVERYTHING */}
                                        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                            {(folder as any).isManaged ? (
                                                <>
                                                    <Monitor className="w-3 h-3" /> Managed Integration
                                                </>
                                            ) : (
                                                <>
                                                    <Folder className="w-3 h-3" /> Monitored Folder
                                                </>
                                            )}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    {!(folder as any).isManaged && (
                                        <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{folder.imageCount} images</span>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => handleRescan(folder.id, (folder as any).pathRaw || folder.path, folder.variant, (folder as any).isManaged)}
                                        disabled={scanningIds.has(folder.id)}
                                        className={`p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all ${scanningIds.has(folder.id) ? 'opacity-50 cursor-wait' : ''}`}
                                        title={(folder as any).isManaged && folder.variant === GeneratorTool.INVOKEAI ? "Sync with InvokeAI Database" : "Rescan Folder"}
                                    >
                                        <RefreshCw className={`w-4 h-4 ${scanningIds.has(folder.id) ? 'animate-spin' : ''}`} />
                                    </button>

                                    {!(folder as any).isManaged && (
                                        <button
                                            type="button"
                                            onClick={() => removeFolder(folder.id)}
                                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {combinedFolders.length === 0 && (
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
                            Add your Model/LoRA folders here. {APP_NAME} will scan them for thumbnails (<span className="font-mono text-xs">.jpg, .png, .webp</span>).
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
