import * as React from 'react';
import { Folder, Info, Monitor, RefreshCw, Trash2, FileJson } from 'lucide-react';
import { GeneratorTool, MonitoredFolder } from '../../../types';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface FolderItemProps {
    folder: MonitoredFolder;
    scanningIds: Set<string>;
    onRescan: (id: string, path: string, variant?: string, isManaged?: boolean) => void;
    onRemove: (id: string) => void;
    onRefresh?: (path: string, force: boolean, variant?: GeneratorTool, isManaged?: boolean) => void;
}

const VARIANT_LABELS: Partial<Record<GeneratorTool, string>> = {
    [GeneratorTool.INVOKEAI]: 'INVOKE',
    [GeneratorTool.COMFYUI]: 'COMFY',
    [GeneratorTool.AUTOMATIC1111]: 'A1111',
    [GeneratorTool.SDNEXT]: 'SD.NEXT',
    [GeneratorTool.FORGE]: 'FORGE',
    [GeneratorTool.ANAPNOE]: 'ANAPNOE',
};

const getVariantIcon = (variant?: GeneratorTool) => {
    const label = variant ? VARIANT_LABELS[variant] : undefined;
    if (!label) return null;

    return (
        <div className="rounded border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
            {label}
        </div>
    );
};

export const FolderItem: React.FC<FolderItemProps> = ({ folder, scanningIds, onRescan, onRemove, onRefresh }) => {
    const isScanning = scanningIds.has(folder.id);
    const path = folder.isManaged ? (folder.pathRaw ?? folder.path) : folder.path;

    return (
        <div className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
            <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex-shrink-0 w-16 flex justify-center">
                    {(!folder.variant || folder.variant === GeneratorTool.UNKNOWN) ? (
                        <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400">
                            <Folder className="w-4 h-4" />
                        </div>
                    ) : getVariantIcon(folder.variant)}
                </div>

                <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate">
                        {path}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        {folder.initialScanCancelled ? (
                            <><Info className="w-3 h-3 text-ember-600 dark:text-ember-300" /> Import cancelled. Rescan to continue.</>
                        ) : folder.isManaged ? (
                            <><Monitor className="w-3 h-3" /> Managed Integration</>
                        ) : (
                            <><Folder className="w-3 h-3" /> Monitored Folder</>
                        )}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-4">
                {!folder.isManaged && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{folder.imageCount} images</span>
                )}

                <TooltipButton
                    label={folder.isManaged && folder.variant === GeneratorTool.INVOKEAI ? "Sync with InvokeAI Database" : "Rescan Folder"}
                    content={folder.isManaged && folder.variant === GeneratorTool.INVOKEAI ? "Sync with InvokeAI Database" : "Rescan Folder"}
                    onClick={() => onRescan(folder.id, path, folder.variant, folder.isManaged)}
                    disabled={isScanning}
                    className={`rounded-lg p-1.5 text-gray-400 transition-all hover:bg-sage-50 hover:text-sage-600 dark:hover:bg-sage-500/10 dark:hover:text-sage-300 ${isScanning ? 'opacity-50 cursor-wait' : ''}`}
                >
                    <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                </TooltipButton>

                {onRefresh && (
                    <TooltipButton
                        label="Resume Smart Refresh"
                        content="Resume Smart Refresh (Shift+Click to Force Refresh All)"
                        onClick={(e) => {
                            // Click = Resume (force=false), Shift+Click = Force (force=true)
                            console.log('[FolderItem] Refresh clicked. Shift:', e.shiftKey, 'Force:', e.shiftKey);
                            onRefresh(path, e.shiftKey, folder.variant, folder.isManaged);
                        }}
                        disabled={isScanning}
                        className="p-1.5 text-gray-400 hover:text-sage-500 hover:bg-sage-50 dark:hover:bg-sage-900/20 rounded-lg transition-all"
                    >
                        <FileJson className="w-4 h-4" />
                    </TooltipButton>
                )}

                {!folder.isManaged && (
                    <TooltipButton
                        label={`Remove Folder: ${path}`}
                        content={`Remove Folder: ${path}`}
                        onClick={() => onRemove(folder.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                    >
                        <Trash2 className="w-4 h-4" />
                    </TooltipButton>
                )}
            </div>
        </div>
    );
};
