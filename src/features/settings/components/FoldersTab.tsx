import * as React from 'react';
import { Monitor } from 'lucide-react';
import { AppSettings } from '../../../types';
import { useFoldersTabLogic } from '../hooks/useFoldersTabLogic';
import { FolderItem } from './FolderItem';
import { AddFolderForm } from './AddFolderForm';
import { ResourceDiscoverySection } from './ResourceDiscoverySection';
import { useMetadataReparse } from '../../../hooks/useMetadataReparse';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<void>;
    onInvokeSync?: () => Promise<void>;
}

export const FoldersTab: React.FC<TabProps> = React.memo(({
    settings,
    setSettings,
    onScanFolder,
    onInvokeSync
}) => {
    const {
        newFolderPath, setNewFolderPath,
        newResourcePath, setNewResourcePath,
        scanningIds,
        combinedFolders,
        fileInputRef,
        resourceInputRef,
        isScanningDiscovery,
        discoveryScanProgress,
        isPopulatingThumbnails,
        handleRescan,
        handleAddFolder,
        removeFolder,
        handleBrowse,
        handleAddResourceFolder,
        handleRemoveResourceFolder,
        handleScanNow
    } = useFoldersTabLogic({ settings, setSettings, onScanFolder, onInvokeSync });

    const { forceReparseAll } = useMetadataReparse();

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
                            <FolderItem
                                key={folder.id}
                                folder={folder}
                                scanningIds={scanningIds}
                                onRescan={handleRescan}
                                onRemove={removeFolder}
                                showDevTools={settings.devMode}
                                onReparse={forceReparseAll}
                            />
                        ))}
                        {combinedFolders.length === 0 && (
                            <div className="text-sm text-gray-400 text-center py-8 italic">No image folders monitored.</div>
                        )}
                    </div>
                    <div className="border-t border-gray-200 dark:border-white/5 p-4 bg-gray-50/50 dark:bg-black/20">
                        <AddFolderForm
                            value={newFolderPath}
                            onChange={setNewFolderPath}
                            onBrowse={handleBrowse}
                            onSubmit={handleAddFolder}
                        />
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            // @ts-ignore
                            webkitdirectory=""
                            directory=""
                        />
                    </div>
                </div>
            </div>

            {/* 2. Resource Discovery Section - Hidden for V1 */}
            {false && (
                <>
                    <ResourceDiscoverySection
                        resourceFolders={settings.resourceFolders || []}
                        isScanning={isScanningDiscovery}
                        scanProgress={discoveryScanProgress}
                        isPopulatingThumbnails={isPopulatingThumbnails}
                        newResourcePath={newResourcePath}
                        setNewResourcePath={setNewResourcePath}
                        onBrowse={handleBrowse} // Shared or separate browse logic?
                        onAdd={handleAddResourceFolder}
                        onRemove={handleRemoveResourceFolder}
                        onScanNow={handleScanNow}
                    />
                    <input
                        type="file"
                        ref={resourceInputRef}
                        className="hidden"
                        // @ts-ignore
                        webkitdirectory=""
                        directory=""
                    />
                </>
            )}
        </div>
    );
});
