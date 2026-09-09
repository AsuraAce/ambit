import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ImageKindFilter, LibraryScopeCounts, MediaTypeFilter, SourceKindCounts } from '../../../types';
import { formatCountCompact } from '../../../utils/formatUtils';

interface LibraryScopeDropdownProps {
    mediaType: MediaTypeFilter;
    sourceKind: ImageKindFilter;
    displayedCount: number;
    scopeCounts?: LibraryScopeCounts;
    scopeAvailability?: LibraryScopeCounts;
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
    onMediaTypeChange,
    onImageKindChange,
}: LibraryScopeDropdownProps) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

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

    React.useEffect(() => {
        if (!isOpen) return;

        const selectedIndex = menuOptions.findIndex(option => option.key === selectedMenuKey);
        optionRefs.current[selectedIndex]?.focus();

        const handlePointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
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
        const currentIndex = optionRefs.current.findIndex(option => option === document.activeElement);
        let nextIndex: number | null = null;

        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % menuOptions.length;
        if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + menuOptions.length) % menuOptions.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = menuOptions.length - 1;

        if (nextIndex !== null) {
            event.preventDefault();
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAndRestoreFocus();
        }
    };

    const getMediaCount = (value: MediaTypeFilter) => (
        scopeCounts?.media[value] ?? (value === mediaType ? displayedCount : undefined)
    );
    const getImageKindCount = (option: typeof IMAGE_KIND_OPTIONS[number]) => (
        scopeCounts?.imageKinds[option.countKey] ?? (isImageScope && option.value === sourceKind ? displayedCount : undefined)
    );

    return (
        <div ref={containerRef} className="relative shrink-0" data-testid="library-scope">
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-label={`Library scope: ${selectedLabel}, ${formatCount(selectedCount)}. Change library scope`}
                onClick={() => setIsOpen(open => !open)}
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
                <div role="dialog" aria-label="Choose library scope" className="absolute left-0 top-full z-[100] mt-2 w-56 rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-zinc-800">
                    <div role="radiogroup" aria-label="Media type" onKeyDown={handleMenuKeyDown}>
                        <div className="px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Media type</div>
                        {visibleMediaOptions.map((option, index) => {
                            const isSelected = option.value === mediaType;
                            const count = getMediaCount(option.value);
                            return (
                                <button key={option.value} ref={element => { optionRefs.current[index] = element; }} type="button" role="radio" aria-checked={isSelected} aria-label={`${option.label}, ${formatCount(count)}`} onClick={() => selectOption({ key: `media:${option.value}`, type: 'media', value: option.value })} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/60 ${isSelected ? 'bg-sage-500/15 text-sage-700 dark:text-sage-200' : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5'}`}>
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isSelected && <Check aria-hidden className="h-3.5 w-3.5" />}</span>
                                    <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                                    <span title={formatCount(count)} className="shrink-0 text-[10px] tabular-nums opacity-70">{count === undefined ? '—' : formatCountCompact(count)}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div role="radiogroup" aria-label="Image kind" onKeyDown={handleMenuKeyDown}>
                        <div className="px-2.5 pb-1.5 pt-3 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Image kind</div>
                        {visibleImageKindOptions.map((option, index) => {
                            const isSelected = option.value === sourceKind;
                            const count = getImageKindCount(option);
                            const optionIndex = visibleMediaOptions.length + index;
                            return (
                                <button key={option.value} ref={element => { optionRefs.current[optionIndex] = element; }} type="button" role="radio" aria-checked={isSelected} aria-label={`${option.label}, ${formatCount(count)}`} onClick={() => selectOption({ key: `image:${option.value}`, type: 'image', value: option.value })} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/60 ${isSelected ? 'bg-sage-500/15 text-sage-700 dark:text-sage-200' : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5'}`}>
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isSelected && <Check aria-hidden className="h-3.5 w-3.5" />}</span>
                                    <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                                    <span title={formatCount(count)} className="shrink-0 text-[10px] tabular-nums opacity-70">{count === undefined ? '—' : formatCountCompact(count)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
});

/** @deprecated Use LibraryScopeDropdown for the combined media and image-kind scope. */
export const ImageKindScopeDropdown = LibraryScopeDropdown;
