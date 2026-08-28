import * as React from 'react';
import { Check } from 'lucide-react';
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
    const unassignedBoards = discovery.unassignedBoardCount ?? 0;
    const unassignedDetails = [
        discovery.unassignedImageCount > 0
            ? `${discovery.unassignedImageCount.toLocaleString()} unassigned image rows`
            : null,
        unassignedBoards > 0
            ? `${unassignedBoards.toLocaleString()} unassigned boards`
            : null,
    ].filter((value): value is string => value !== null).join(' and ');
    const allUsersMessage = unassignedDetails
        ? `Ambit will show every owner's InvokeAI content, including ${unassignedDetails}, across the gallery, collections, maintenance views, and references. You can return to a single owner at any time.`
        : "Ambit will show every owner's InvokeAI images and boards from this local database. You can return to a single owner at any time.";

    return (
        <div className="space-y-3">
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                Choose whose InvokeAI images Ambit may show. Display names and stable IDs are shown; email addresses are never read.
            </p>
            {discovery.owners.map(owner => {
                const selected = selection?.mode === 'owner' && selection.ownerId === owner.ownerId;
                const intermediateImageCount = owner.intermediateImageCount ?? 0;
                const standardImageCount = owner.imageCount - intermediateImageCount;
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
                            <span className="flex shrink-0 items-center gap-2">
                                <span className="text-right text-[10px] font-bold text-gray-500">
                                    <span className="block">
                                        {standardImageCount.toLocaleString()} {intermediateImageCount > 0 ? 'standard images' : 'images'}
                                    </span>
                                    {intermediateImageCount > 0 && (
                                        <span className="block">{intermediateImageCount.toLocaleString()} intermediates</span>
                                    )}
                                    {owner.boardCount !== undefined && (
                                        <span className="block">{owner.boardCount.toLocaleString()} boards</span>
                                    )}
                                </span>
                                {selected ? <Check className="h-4 w-4 text-sage-600 dark:text-sage-300" aria-hidden="true" /> : null}
                            </span>
                        </span>
                    </button>
                );
            })}

            {discovery.unassignedImageCount > 0 && (
                <p className="text-[10px] leading-4 text-ember-600 dark:text-ember-300">
                    {discovery.unassignedImageCount.toLocaleString()} image rows have no owner and remain hidden in single-owner scope.
                </p>
            )}

            {unassignedBoards > 0 && (
                <p className="text-[10px] leading-4 text-ember-600 dark:text-ember-300">
                    {unassignedBoards.toLocaleString()} boards have no owner and remain hidden in single-owner scope.
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
                    ? 'border-ember-500 bg-ember-500/10'
                    : 'border-gray-200 hover:border-ember-500/50 dark:border-white/10'}`}
            >
                <span className="flex items-center justify-between gap-3">
                    <span className="block text-sm font-bold text-gray-800 dark:text-gray-100">All users</span>
                    {selection?.mode === 'all' ? <Check className="h-4 w-4 shrink-0 text-ember-600 dark:text-ember-300" aria-hidden="true" /> : null}
                </span>
                <span className="block text-[10px] leading-4 text-gray-500">
                    Show every owner's images and boards, including unassigned rows.
                </span>
            </button>

            {selectionRequired && (
                <div className="rounded-xl border border-ember-500/20 bg-ember-500/10 p-3 text-[10px] leading-4 text-ember-600 dark:text-ember-300">
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
