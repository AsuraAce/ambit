import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ImageKindFilter, LibraryScopeCounts, MediaTypeFilter } from '../../../types';
import { formatCountCompact } from '../../../utils/formatUtils';

interface LibraryScopeSelection {
    mediaType: MediaTypeFilter;
    sourceKind: ImageKindFilter;
}

interface LibraryScopeDropdownProps {
    mediaType: MediaTypeFilter;
    sourceKind: ImageKindFilter;
    displayedCount: number | undefined;
    scopeCounts?: LibraryScopeCounts;
    scopeAvailability?: LibraryScopeCounts;
    countsLoading?: boolean;
    countsError?: boolean;
    onRetryCounts?: () => void;
    onScopeChange: (value: LibraryScopeSelection) => void;
}

const SCOPE_OPTIONS: Array<LibraryScopeSelection & { key: string; label: string }> = [
    { key: 'all', label: 'All Media', mediaType: 'all', sourceKind: 'all' },
    { key: 'images', label: 'All Images', mediaType: 'image', sourceKind: 'all' },
    { key: 'generated', label: 'Generated Images', mediaType: 'image', sourceKind: 'generated' },
    { key: 'photos', label: 'Photos', mediaType: 'image', sourceKind: 'photograph' },
    { key: 'other', label: 'Other Images', mediaType: 'image', sourceKind: 'other' },
    { key: 'videos', label: 'Videos', mediaType: 'video', sourceKind: 'all' },
];

const formatCount = (count: number | undefined) => count?.toLocaleString() ?? '—';
const getScopeCount = (counts: LibraryScopeCounts | undefined, scope: LibraryScopeSelection) => (
    scope.mediaType === 'image' && scope.sourceKind !== 'all'
        ? counts?.imageKinds[scope.sourceKind]
        : counts?.media[scope.mediaType]
);

export const LibraryScopeDropdown = React.memo(({
    mediaType,
    sourceKind,
    displayedCount,
    scopeCounts,
    scopeAvailability,
    countsLoading,
    countsError,
    onRetryCounts,
    onScopeChange,
}: LibraryScopeDropdownProps) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);
    const openingFocusRef = React.useRef<'selected' | 'first' | 'last'>('selected');
    const menuId = React.useId();
    const getMenuItems = React.useCallback(() => Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]') ?? []
    ), []);

    const selectedOption = SCOPE_OPTIONS.find(option => (
        option.mediaType === mediaType && (mediaType !== 'image' || option.sourceKind === sourceKind)
    )) ?? SCOPE_OPTIONS[0];
    const selectedLabel = selectedOption.label;
    const selectedCount = getScopeCount(scopeCounts, selectedOption) ?? displayedCount;
    const visibleOptions = SCOPE_OPTIONS.filter(option => (
        option.key === 'all'
        || option.key === 'images'
        || option.key === selectedOption.key
        || scopeAvailability === undefined
        || getScopeCount(scopeAvailability, option) !== 0
    ));
    const selectedMenuKey = selectedOption.key;
    const menuKeys = visibleOptions.map(option => option.key).join('|') + (countsError ? '|retry' : '');

    React.useLayoutEffect(() => {
        if (!isOpen || menuRef.current?.contains(document.activeElement)) return;
        const items = getMenuItems();
        const target = openingFocusRef.current === 'first' ? items[0]
            : openingFocusRef.current === 'last' ? items[items.length - 1]
                : items.find(item => item.dataset.scopeOption === selectedMenuKey);
        (target ?? items[0])?.focus();
        openingFocusRef.current = 'selected';
    }, [isOpen, menuKeys, selectedMenuKey, getMenuItems]);

    React.useEffect(() => {
        if (!isOpen) return;

        const handleOutside = (event: Event) => {
            if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const handleWindowBlur = () => setIsOpen(false);
        document.addEventListener('pointerdown', handleOutside);
        document.addEventListener('focusin', handleOutside);
        window.addEventListener('blur', handleWindowBlur);
        return () => {
            document.removeEventListener('pointerdown', handleOutside);
            document.removeEventListener('focusin', handleOutside);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [isOpen]);

    const closeAndRestoreFocus = React.useCallback(() => {
        setIsOpen(false);
        triggerRef.current?.focus();
    }, []);

    const selectOption = React.useCallback((option: LibraryScopeSelection) => {
        onScopeChange({ mediaType: option.mediaType, sourceKind: option.sourceKind });
        closeAndRestoreFocus();
    }, [closeAndRestoreFocus, onScopeChange]);

    const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const items = getMenuItems();
        const currentIndex = items.findIndex(option => option === document.activeElement);
        let nextIndex: number | null = null;

        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
        if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = items.length - 1;

        if (nextIndex !== null) {
            event.preventDefault();
            event.stopPropagation();
            items[nextIndex]?.focus();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeAndRestoreFocus();
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            items[currentIndex]?.click();
        }
        if (event.key === 'Tab') {
            // Anchor native Tab traversal at the trigger, without trapping focus.
            closeAndRestoreFocus();
        }
    };

    return (
        <div ref={containerRef} className="relative shrink-0" data-testid="library-scope">
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="menu"
                aria-controls={isOpen ? menuId : undefined}
                aria-expanded={isOpen}
                aria-label={`Library scope: ${selectedLabel}, ${formatCount(selectedCount)}. Change library scope`}
                onClick={() => setIsOpen(open => !open)}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    event.stopPropagation();
                    openingFocusRef.current = event.key === 'ArrowDown' ? 'first' : 'last';
                    setIsOpen(true);
                }}
                className={`flex h-10 min-w-[7rem] items-center justify-between gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/60 ${mediaType !== 'all'
                    ? 'border-sage-500/30 bg-sage-500/10 text-sage-700 dark:text-sage-200'
                    : 'border-gray-200 bg-gray-100 text-gray-600 hover:text-gray-900 dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:text-white'
                    }`}
            >
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{selectedLabel}</span>
                </span>
                <ChevronDown aria-hidden className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div ref={menuRef} id={menuId} role="menu" aria-label="Choose library scope" onKeyDown={handleMenuKeyDown} className="absolute left-0 top-full z-[100] mt-2 w-56 rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-zinc-800">
                    {countsLoading && <span role="status" className="sr-only">Loading counts</span>}
                    {visibleOptions.map(option => {
                        const isSelected = option.key === selectedMenuKey;
                        const count = getScopeCount(scopeCounts, option) ?? (isSelected ? displayedCount : undefined);
                        return (
                            <React.Fragment key={option.key}>
                                {option.key === 'images' && (
                                    <div aria-hidden="true" className="mt-1.5 border-t border-gray-200 px-2.5 pb-1.5 pt-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:border-white/10 dark:text-zinc-300">Images</div>
                                )}
                                {option.key === 'videos' && <div role="separator" className="my-1.5 border-t border-gray-200 dark:border-white/10" />}
                                <button data-scope-option={option.key} type="button" role="menuitemradio" tabIndex={-1} aria-checked={isSelected} aria-label={`${option.label}, ${formatCount(count)}`} onClick={() => selectOption(option)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/60 ${isSelected ? 'bg-sage-500/15 text-sage-700 dark:text-sage-200' : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5'}`}>
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isSelected && <Check aria-hidden className="h-3.5 w-3.5" />}</span>
                                    <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                                    <span title={formatCount(count)} className="shrink-0 text-[10px] tabular-nums opacity-70">{count === undefined ? '—' : formatCountCompact(count)}</span>
                                </button>
                            </React.Fragment>
                        );
                    })}
                    {countsError && (
                        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-gray-200 px-2.5 pt-2 text-[10px] dark:border-white/10">
                            <span role="status" className="text-ember-600 dark:text-ember-300">Counts unavailable</span>
                            <button type="button" role="menuitem" tabIndex={-1} aria-disabled={countsLoading} onClick={() => {
                                if (countsLoading) return;
                                onRetryCounts?.();
                                closeAndRestoreFocus();
                            }} className="rounded px-1 py-1 font-semibold text-sage-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/60 aria-disabled:opacity-50 dark:text-sage-300">Retry counts</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

/** @deprecated Use LibraryScopeDropdown for the combined media and image-kind scope. */
export const ImageKindScopeDropdown = LibraryScopeDropdown;
