import * as React from 'react';
import { useCallback } from 'react';
import { AlertTriangle, Zap, RefreshCw, Check, Image, Trash2, Database } from 'lucide-react';
import { AIImage } from '../../../types';
import { VirtualGrid } from '../../library/components/VirtualGrid';
import { MaintenanceItem } from './MaintenanceItem';
import { MaintenanceHeader } from './MaintenanceHeader';
import { useToast } from '../../../hooks/useToast';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { cleanupOrphanThumbnails, pruneBrokenThumbnails, syncExistingThumbnailsToDB } from '../../../services/thumbnailService';
import { areDeveloperFeaturesEnabled } from '../../../utils/settingsUtils';

interface ThumbnailsTabProps {
    images: AIImage[];
    totalCount: number;
    selectedIds: Set<string>;
    onItemClick: (id: string, index: number, e: React.MouseEvent) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onRegenerate: (ids?: string[]) => void;
    thumbnailsScope: 'global' | 'filtered';
    onScopeChange: (scope: 'global' | 'filtered') => void;
    maskedKeywords: string[];
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    onRangeSelection: (indexes: number[], isAdditive: boolean) => void;
    onBackgroundClick: () => void;
    includeUpgradeable: boolean;
    onIncludeUpgradeableChange: (include: boolean) => void;
    onRepairComplete?: () => Promise<void>;
}

export const ThumbnailsTab: React.FC<ThumbnailsTabProps> = ({
    images,
    totalCount,
    selectedIds,
    onItemClick,
    onSelectAll,
    onClearSelection,
    onRegenerate,
    thumbnailsScope,
    onScopeChange,
    maskedKeywords,
    scrollContainerRef,
    onRangeSelection,
    onBackgroundClick,
    includeUpgradeable,
    onIncludeUpgradeableChange,
    onRepairComplete
}) => {
    const developerFeaturesEnabled = useSettingsStore(s => areDeveloperFeaturesEnabled(s.settings));

    const renderItem = useCallback((img: AIImage, style: React.CSSProperties, index: number) => {
        return (
            <MaintenanceItem
                key={img.id}
                img={img}
                style={style}
                isSelected={selectedIds.has(img.id)}
                onClick={(e) => onItemClick(img.id, index, e)}
                maskedKeywords={maskedKeywords}
            />
        );
    }, [selectedIds, onItemClick, maskedKeywords]);

    // Read directly from store for faster reactivity (context can lag)
    const isRegeneratingThumbnails = useLibraryStore(s => s.isRegeneratingThumbnails);
    const isBackgroundHealingActive = useLibraryStore(s => s.isBackgroundHealingActive);
    const maintenanceOperation = useLibraryStore(s => s.thumbnailMaintenanceOperation);
    const setMaintenanceOperation = useLibraryStore(s => s.setThumbnailMaintenanceOperation);
    const { addToast } = useToast();
    const isMaintenanceBusy = maintenanceOperation !== null;
    const controlsDisabled = isRegeneratingThumbnails || isBackgroundHealingActive || isMaintenanceBusy;
    const disabledReason = isBackgroundHealingActive
        ? 'Wait for Smart Thumbnail Optimization to finish'
        : undefined;

    const claimMaintenanceOperation = (operation: NonNullable<typeof maintenanceOperation>): boolean => {
        const state = useLibraryStore.getState();
        if (
            state.isRegeneratingThumbnails
            || state.isBackgroundHealingActive
            || state.thumbnailMaintenanceOperation !== null
        ) {
            return false;
        }

        state.setThumbnailMaintenanceOperation(operation);
        return true;
    };

    const handleCleanup = async () => {
        if (!claimMaintenanceOperation('cleanup')) return;
        try {
            const count = await cleanupOrphanThumbnails();
            if (count > 0) {
                addToast(`Cleaned up ${count} orphan thumbnail${count === 1 ? '' : 's'}`, 'success');
            } else {
                addToast('No orphan thumbnails found', 'info');
            }
        } catch (e) {
            addToast('Failed to clean up thumbnails', 'error');
        } finally {
            setMaintenanceOperation(null);
        }
    };

    const handleSync = async () => {
        if (!claimMaintenanceOperation('sync')) return;
        try {
            const count = await syncExistingThumbnailsToDB();
            if (count > 0) {
                addToast(`Synced ${count} existing thumbnail${count === 1 ? '' : 's'} to database`, 'success');
            } else {
                addToast('All thumbnails already synced to database', 'info');
            }
        } catch (e) {
            addToast('Failed to sync thumbnails', 'error');
        } finally {
            setMaintenanceOperation(null);
        }
    };

    const handleRepairBrokenThumbnails = async () => {
        if (!claimMaintenanceOperation('repair')) return;
        try {
            addToast('Checking thumbnail files...', 'info');
            const count = await pruneBrokenThumbnails();
            if (count > 0) {
                addToast(`Repaired ${count} broken thumbnail reference${count === 1 ? '' : 's'}.`, 'success');
            } else {
                addToast('No broken thumbnail references found', 'info');
            }
            await onRepairComplete?.();
        } catch (e) {
            console.error(e);
            addToast('Failed to repair broken thumbnails', 'error');
        } finally {
            setMaintenanceOperation(null);
        }
    };

    const actions = (
        <div className="flex flex-wrap items-center gap-3">
            {/* Scope Toggle */}
            <div className="flex items-center gap-1 p-1 bg-white/50 dark:bg-black/20 border border-sage-200/50 dark:border-white/5 rounded-xl mr-2">
                <button
                    disabled={controlsDisabled}
                    title={disabledReason}
                    onClick={() => onScopeChange('global')}
                    className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${thumbnailsScope === 'global' ? 'bg-white dark:bg-zinc-800 text-sage-600 shadow-sm' : 'text-gray-400'} ${controlsDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    Library
                </button>
                <button
                    disabled={controlsDisabled}
                    title={disabledReason}
                    onClick={() => onScopeChange('filtered')}
                    className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${thumbnailsScope === 'filtered' ? 'bg-white dark:bg-zinc-800 text-sage-600 shadow-sm' : 'text-gray-400'} ${controlsDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    Filtered View
                </button>
            </div>

            <div className="flex items-center gap-2 mr-2 px-2 py-1 bg-white/50 dark:bg-black/20 border border-sage-200/50 dark:border-white/5 rounded-xl">
                <input
                    type="checkbox"
                    id="includeUpgradeable"
                    checked={includeUpgradeable}
                    onChange={(e) => onIncludeUpgradeableChange(e.target.checked)}
                    disabled={controlsDisabled}
                    title={disabledReason}
                    className="w-3.5 h-3.5 rounded-md border-gray-300 text-sage-600 focus:ring-sage-500 cursor-pointer"
                />
                <label htmlFor="includeUpgradeable" className="text-[10px] font-medium text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                    Include upgradeable
                </label>
            </div>

            {selectedIds.size > 0 ? (
                <button
                    disabled={controlsDisabled}
                    title={disabledReason}
                    onClick={() => onRegenerate(Array.from(selectedIds))}
                    className="px-4 py-2 bg-sage-500 hover:bg-sage-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 group shadow-md shadow-sage-500/20"
                >
                    <Zap className={`w-4 h-4 ${!isRegeneratingThumbnails && 'group-hover:rotate-12'} transition-transform`} />
                    {isRegeneratingThumbnails ? 'Processing...' : 'Regenerate Selected'}
                    <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{selectedIds.size}</span>
                </button>
            ) : (
                <button
                    disabled={controlsDisabled}
                    title={disabledReason}
                    onClick={() => onRegenerate()}
                    className="px-4 py-2 bg-sage-500 hover:bg-sage-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 group shadow-md shadow-sage-500/20"
                >
                    <RefreshCw className={`w-4 h-4 ${!isRegeneratingThumbnails && 'group-hover:rotate-180'} transition-transform duration-700`} />
                    {isRegeneratingThumbnails ? 'Optimizing Library...' : 'Regenerate All Unoptimized'}
                    {totalCount > 0 && <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{totalCount.toLocaleString()}</span>}
                </button>
            )}

            <button
                disabled={controlsDisabled}
                onClick={handleRepairBrokenThumbnails}
                className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-amber-700 dark:text-amber-300 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-amber-500/20"
                title={disabledReason ?? 'Check thumbnail files on disk and reset missing thumbnail references'}
            >
                <AlertTriangle className={`w-4 h-4 ${maintenanceOperation === 'repair' ? 'animate-pulse' : ''}`} />
                {maintenanceOperation === 'repair' ? 'Repairing...' : 'Repair Broken Thumbnails'}
            </button>

            {/* Sync DB Button - heals thumbnails that exist on disk but aren't in DB */}
            {developerFeaturesEnabled && (
                <button
                    disabled={controlsDisabled}
                    onClick={handleSync}
                    className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-amber-600 dark:text-amber-400 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-amber-500/20"
                    title={disabledReason ?? 'Sync existing thumbnail files to database (heals thumbnails created before the persistence fix)'}
                >
                    <Database className={`w-4 h-4 ${maintenanceOperation === 'sync' ? 'animate-pulse' : ''}`} />
                    {maintenanceOperation === 'sync' ? 'Syncing...' : 'Sync DB'}
                </button>
            )}
        </div>
    );

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col items-stretch">
            <MaintenanceHeader
                title="Thumbnail Optimization"
                description={totalCount > images.length
                    ? `Found ${totalCount.toLocaleString()} images ${thumbnailsScope === 'filtered' ? 'in current filter' : ''} that need optimization. Showing first ${images.length}.`
                    : `Found ${totalCount.toLocaleString()} images ${thumbnailsScope === 'filtered' ? 'in current filter' : ''} that could benefit from thumbnail regeneration.`
                }
                icon={<Image className="w-6 h-6" />}
                count={totalCount}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
                selectedCount={selectedIds.size}
                actions={actions}
                variant="blue"
            />

            {images.length > 0 ? (
                <VirtualGrid
                    items={images}
                    renderItem={renderItem}
                    layout="masonry"
                    minItemWidth={200}
                    gap={16}
                    padding={0}
                    scrollContainerRef={scrollContainerRef}
                    onRangeSelection={onRangeSelection}
                    onBackgroundClick={onBackgroundClick}
                />
            ) : (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <div className="p-6 bg-blue-500/10 rounded-full mb-6 border border-blue-500/20">
                        <Check className="w-16 h-16 text-blue-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Optimized</h2>
                    <p className="max-w-md text-center text-gray-500 dark:text-gray-400">
                        All images in this scope have high-quality thumbnails.
                    </p>
                    <button
                        onClick={handleCleanup}
                        disabled={controlsDisabled}
                        title={disabledReason}
                        className="mt-4 flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                    >
                        <Trash2 className={`w-3.5 h-3.5 ${maintenanceOperation === 'cleanup' ? 'animate-pulse' : ''}`} />
                        {maintenanceOperation === 'cleanup' ? 'Cleaning up...' : 'Clean up unused thumbnails'}
                    </button>
                </div>
            )}
        </div>
    );
};
