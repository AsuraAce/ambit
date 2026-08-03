import * as React from 'react';
import type { InvokeOwnerDiscovery, InvokeOwnerSelection } from '../../types';
import { ConfirmDialog } from './ConfirmDialog';

interface InvokeOwnerScopeSelectorProps {
    discovery: InvokeOwnerDiscovery;
    selection?: InvokeOwnerSelection;
    disabled?: boolean;
    selectionRequired?: boolean;
    onSelect: (selection: InvokeOwnerSelection) => void | Promise<void>;
}

export const InvokeOwnerScopeSelector: React.FC<InvokeOwnerScopeSelectorProps> = ({
    discovery,
    selection,
    disabled = false,
    selectionRequired = false,
    onSelect,
}) => {
    const [isAllUsersConfirmOpen, setIsAllUsersConfirmOpen] = React.useState(false);
    const allUsersMessage = discovery.unassignedImageCount > 0
        ? `Ambit will show every owner's images and ${discovery.unassignedImageCount.toLocaleString()} unassigned image rows from this local InvokeAI database across the gallery, collections, maintenance views, and references. You can return to a single owner at any time.`
        : "Ambit will show every owner's images, including any unassigned image rows, from this local InvokeAI database across the gallery, collections, maintenance views, and references. You can return to a single owner at any time.";

    return (
        <div className="space-y-3">
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                Choose whose InvokeAI images Ambit may show. Display names and stable IDs are shown; email addresses are never read.
            </p>
            {discovery.owners.map(owner => {
                const selected = selection?.mode === 'owner' && selection.ownerId === owner.ownerId;
                return (
                    <button
                        key={owner.ownerId}
                        type="button"
                        disabled={disabled}
                        aria-pressed={selected}
                        onClick={() => {
                            if (selected) return;
                            void onSelect({
                                dbPath: discovery.dbPath,
                                mode: 'owner',
                                ownerId: owner.ownerId,
                            });
                        }}
                        className={`w-full rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected
                            ? 'border-sage-500 bg-sage-500/10'
                            : 'border-gray-200 hover:border-sage-500/50 dark:border-white/10'}`}
                    >
                        <span className="flex items-center justify-between gap-3">
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100">
                                    {owner.displayName || 'Unnamed owner'}{owner.isStale ? ' (not currently represented)' : ''}
                                </span>
                                <span className="block break-all font-mono text-[10px] text-gray-500">{owner.ownerId}</span>
                            </span>
                            <span className="shrink-0 text-[10px] font-bold text-gray-500">
                                {owner.imageCount.toLocaleString()} images
                            </span>
                        </span>
                    </button>
                );
            })}

            {discovery.unassignedImageCount > 0 && (
                <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                    {discovery.unassignedImageCount.toLocaleString()} image rows have no owner and remain hidden in single-owner scope.
                </p>
            )}

            <button
                type="button"
                disabled={disabled}
                aria-pressed={selection?.mode === 'all'}
                onClick={() => {
                    if (selection?.mode === 'all') return;
                    setIsAllUsersConfirmOpen(true);
                }}
                className={`w-full rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selection?.mode === 'all'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-gray-200 hover:border-amber-500/50 dark:border-white/10'}`}
            >
                <span className="block text-sm font-bold text-gray-800 dark:text-gray-100">All users</span>
                <span className="block text-[10px] leading-4 text-gray-500">
                    Show every owner's images, including unassigned image rows.
                </span>
            </button>

            {selectionRequired && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                    Select an owner or explicitly choose All users. InvokeAI rows remain hidden until then.
                </div>
            )}

            <ConfirmDialog
                isOpen={isAllUsersConfirmOpen}
                title="Show images from all InvokeAI users?"
                message={allUsersMessage}
                confirmLabel="Show All Users"
                onConfirm={() => {
                    setIsAllUsersConfirmOpen(false);
                    void onSelect({ dbPath: discovery.dbPath, mode: 'all' });
                }}
                onCancel={() => setIsAllUsersConfirmOpen(false)}
                zIndex={220}
            />
        </div>
    );
};
