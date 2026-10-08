import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ImageKindFilter, LibraryScopeCounts, MediaTypeFilter, SourceKindCounts } from '../../../types';
import { formatCountCompact } from '../../../utils/formatUtils';

interface LibraryScopeDropdownProps {
    mediaType: MediaTypeFilter;
    sourceKind: ImageKindFilter;
    displayedCount: number | undefined;
    scopeCounts?: LibraryScopeCounts;
    scopeAvailability?: LibraryScopeCounts;
    countsLoading?: boolean;
    countsError?: boolean;
    onRetryCounts?: () => void;
    onMediaTypeChange: (value: MediaTypeFilter) => void;
    onImageKindChange: (value: ImageKindFilter) => void;
}

const MEDIA_OPTIONS: Array<{ value: MediaTypeFilter; label: string }> = [
    { value: 'all', label: 'All Media' },
    { value: 'image', label: 'Images' },
    { value: 'video', label: 'Videos' },
];

const IMAGE_KIND_OPTIONS: Array<{ value: ImageKindFilter; label: string; countKey: keyof SourceKindCounts }> = [
    { value: 'all', label: 'All Images', countKey: 'all' },
    { value: 'generated', label: 'Generated', countKey: 'generated' },
    { value: 'photograph', label: 'Photos', countKey: 'photograph' },
    { value: 'other', label: 'Other', countKey: 'other' },
];

const formatCount = (count: number | undefined) => count?.toLocaleString() ?? '—';

export const LibraryScopeDropdown = React.memo(({
    mediaType,
    sourceKind,
    displayedCount,
    scopeCounts,
    scopeAvailability,
    countsLoading,
    countsError,
    onRetryCounts,
    onMediaTypeChange,
    onImageKindChange,
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

    const selectedMedia = MEDIA_OPTIONS.find(option => option.value === mediaType) ?? MEDIA_OPTIONS[0];
    const selectedImageKind = IMAGE_KIND_OPTIONS.find(option => option.value === sourceKind) ?? IMAGE_KIND_OPTIONS[0];
    const isImageScope = mediaType === 'image';
    const selectedLabel = isImageScope
        ? (selectedImageKind.value === 'all' ? 'Images' : selectedImageKind.label)
        : selectedMedia.label;
    const selectedCount = scopeCounts
        ? (isImageScope ? scopeCounts.imageKinds[selectedImageKind.countKey] : scopeCounts.media[mediaType])
        : displayedCount;

    const visibleMediaOptions = MEDIA_OPTIONS.filter(option => (
        option.value === 'all'
        || option.value === mediaType
        || scopeAvailability === undefined
        || scopeAvailability.media[option.value] !== 0
    ));
    const visibleImageKindOptions = IMAGE_KIND_OPTIONS.filter(option => (
        option.value === 'all'
        || option.value === sourceKind
        || scopeAvailability === undefined
        || scopeAvailability.imageKinds[option.countKey] !== 0
    ));
    const menuOptions = [
        ...visibleMediaOptions.map(option => ({ key: `media:${option.value}`, type: 'media' as const, value: option.value })),
        ...visibleImageKindOptions.map(option => ({ key: `image:${option.value}`, type: 'image' as const, value: option.value })),
    ];
    const selectedMenuKey = isImageScope ? `image:${selectedImageKind.value}` : `media:${selectedMedia.value}`;
    const menuKeys = menuOptions.map(option => option.key).join('|') + (countsError ? '|retry' : '');

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

    const selectOption = React.useCallback((option: typeof menuOptions[number]) => {
        if (option.type === 'media') onMediaTypeChange(option.value);
        else onImageKindChange(option.value);
        closeAndRestoreFocus();
    }, [closeAndRestoreFocus, onImageKindChange, onMediaTypeChange]);

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

    const getMediaCount = (value: MediaTypeFilter) => value === 'image'
        ? scopeCounts?.imageKinds[selectedImageKind.countKey] ?? (isImageScope ? displayedCount : undefined)
        : scopeCounts?.media[value] ?? (value === mediaType ? displayedCount : undefined);
    const getImageKindCount = (option: typeof IMAGE_KIND_OPTIONS[number]) => (
        scopeCounts?.imageKinds[option.countKey] ?? (isImageScope && option.value === sourceKind ? displayedCount : undefined)
    );

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
                    <div role="group" aria-label="Media type">
                        <div className="px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Media type</div>
                        {visibleMediaOptions.map(option => {
                            const isSelected = option.value === mediaType;
                            const count = getMediaCount(option.value);
                            const label = option.value === 'image' && selectedImageKind.value !== 'all'
                                ? `Images · ${selectedImageKind.label}` : option.label;
                            return (
                                <button key={option.value} data-scope-option={`media:${option.value}`} type="button" role="menuitemradio" tabIndex={-1} aria-checked={isSelected} aria-label={`${label}, ${formatCount(count)}`} onClick={() => selectOption({ key: `media:${option.value}`, type: 'media', value: option.value })} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/60 ${isSelected ? 'bg-sage-500/15 text-sage-700 dark:text-sage-200' : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5'}`}>
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isSelected && <Check aria-hidden className="h-3.5 w-3.5" />}</span>
                                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                                    <span title={formatCount(count)} className="shrink-0 text-[10px] tabular-nums opacity-70">{count === undefined ? '—' : formatCountCompact(count)}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div role="group" aria-label="Image kind">
                        <div className="px-2.5 pb-1.5 pt-3 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Image kind</div>
                        {visibleImageKindOptions.map(option => {
                            const isSelected = isImageScope && option.value === sourceKind;
                            const count = getImageKindCount(option);
                            return (
                                <button key={option.value} data-scope-option={`image:${option.value}`} type="button" role="menuitemradio" tabIndex={-1} aria-checked={isSelected} aria-label={`${option.label}, ${formatCount(count)}`} onClick={() => selectOption({ key: `image:${option.value}`, type: 'image', value: option.value })} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/60 ${isSelected ? 'bg-sage-500/15 text-sage-700 dark:text-sage-200' : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5'}`}>
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isSelected && <Check aria-hidden className="h-3.5 w-3.5" />}</span>
                                    <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                                    <span title={formatCount(count)} className="shrink-0 text-[10px] tabular-nums opacity-70">{count === undefined ? '—' : formatCountCompact(count)}</span>
                                </button>
                            );
                        })}
                    </div>
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
