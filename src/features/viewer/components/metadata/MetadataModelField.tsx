import * as React from 'react';
import { Box, Check, Pencil } from 'lucide-react';
import { formatModelName } from '../../../../utils/formatUtils';
import { MetadataField } from './MetadataField';
import type { ModelPresentation } from './modelPresentation';

interface MetadataModelFieldProps {
    presentation: ModelPresentation;
    options: readonly string[];
    source?: string;
    modified?: boolean;
    onSave?: (value: string) => void;
}

const normalizeOptions = (options: readonly string[], presentation: ModelPresentation): string[] => {
    const values = presentation.isHashFallback || presentation.value === 'Unknown'
        ? options
        : [presentation.value, ...options];
    const unique = new Map<string, string>();
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || trimmed.toLocaleLowerCase() === 'unknown') continue;
        if (!unique.has(trimmed.toLocaleLowerCase())) unique.set(trimmed.toLocaleLowerCase(), trimmed);
    }
    return Array.from(unique.values());
};

export const MetadataModelField: React.FC<MetadataModelFieldProps> = ({
    presentation,
    options,
    source,
    modified,
    onSave,
}) => {
    const availableOptions = React.useMemo(
        () => normalizeOptions(options, presentation),
        [options, presentation.isHashFallback, presentation.value]
    );
    const [isEditing, setIsEditing] = React.useState(false);
    const [isCustom, setIsCustom] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [draft, setDraft] = React.useState('');
    const [isOpen, setIsOpen] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const listboxId = React.useId();

    const filteredOptions = React.useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) return availableOptions;
        return availableOptions.filter(option => option.toLocaleLowerCase().includes(normalizedQuery));
    }, [availableOptions, query]);

    React.useEffect(() => {
        setIsEditing(false);
        setIsCustom(false);
        setQuery('');
        setDraft(presentation.isHashFallback || presentation.value === 'Unknown' ? '' : presentation.value);
    }, [presentation.isHashFallback, presentation.value]);

    const startEditing = () => {
        setDraft(presentation.isHashFallback || presentation.value === 'Unknown' ? '' : presentation.value);
        setQuery('');
        setIsCustom(false);
        setIsEditing(true);
        setIsOpen(true);
        setActiveIndex(0);
    };

    const cancel = () => {
        setIsEditing(false);
        setIsCustom(false);
        setIsOpen(false);
    };

    const chooseOption = (value: string) => {
        setDraft(value);
        setQuery(value);
        setIsOpen(false);
    };

    const chooseCustom = () => {
        setDraft('');
        setQuery('');
        setIsCustom(true);
        setIsOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const save = () => {
        const value = draft.trim();
        if (!value) return;
        if (value !== presentation.value) onSave?.(value);
        setIsEditing(false);
        setIsCustom(false);
        setIsOpen(false);
    };

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const itemCount = filteredOptions.length + 1;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex(index => (index + 1) % itemCount);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex(index => (index - 1 + itemCount) % itemCount);
        } else if (event.key === 'Enter' && isOpen) {
            event.preventDefault();
            if (activeIndex < filteredOptions.length) chooseOption(filteredOptions[activeIndex]);
            else chooseCustom();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (isOpen) setIsOpen(false);
            else cancel();
        }
    };

    return (
        <MetadataField label="Model" icon={Box} source={source} modified={modified}>
            <div className="group relative">
                {onSave && !isEditing ? (
                    <button type="button" aria-label="Edit Model" onClick={startEditing} className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-zinc-500 opacity-0 transition-opacity hover:text-white focus-visible:opacity-100 group-hover:opacity-100">
                        <Pencil className="h-3.5 w-3.5" />
                    </button>
                ) : null}
                {isEditing ? (
                    <div className="relative flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
                        {isCustom ? (
                            <input ref={inputRef} aria-label="Custom model name" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Enter model name…" className="w-full rounded border border-white/10 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-sage-500" />
                        ) : (
                            <div className="relative">
                                <input
                                    ref={inputRef}
                                    role="combobox"
                                    aria-label="Search models"
                                    aria-autocomplete="list"
                                    aria-expanded={isOpen}
                                    aria-controls={listboxId}
                                    aria-activedescendant={isOpen ? `${listboxId}-option-${activeIndex}` : undefined}
                                    value={query}
                                    onFocus={() => setIsOpen(true)}
                                    onChange={event => { setQuery(event.target.value); setDraft(''); setIsOpen(true); setActiveIndex(0); }}
                                    onKeyDown={handleSearchKeyDown}
                                    placeholder="Search library models…"
                                    autoFocus
                                    className="w-full rounded border border-white/10 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-sage-500"
                                />
                                {isOpen ? (
                                    <ul id={listboxId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-zinc-900 p-1 shadow-2xl">
                                        {filteredOptions.map((option, index) => (
                                            <li
                                                id={`${listboxId}-option-${index}`}
                                                key={option}
                                                role="option"
                                                aria-selected={activeIndex === index}
                                                onClick={() => chooseOption(option)}
                                                className={`cursor-pointer rounded px-2 py-1.5 text-xs ${activeIndex === index ? 'bg-sage-500/20 text-sage-200' : 'text-zinc-300 hover:bg-white/5'}`}
                                            >
                                                {formatModelName(option)}
                                            </li>
                                        ))}
                                        <li
                                            id={`${listboxId}-option-${filteredOptions.length}`}
                                            role="option"
                                            aria-selected={activeIndex === filteredOptions.length}
                                            onClick={chooseCustom}
                                            className={`cursor-pointer rounded border-t border-white/5 px-2 py-1.5 text-xs ${activeIndex === filteredOptions.length ? 'bg-sage-500/20 text-sage-200' : 'text-zinc-400 hover:bg-white/5'}`}
                                        >
                                            Custom model…
                                        </li>
                                    </ul>
                                ) : null}
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={cancel} className="px-2 py-1 text-xs text-zinc-500 hover:text-white">Cancel</button>
                            <button type="button" disabled={!draft.trim()} onClick={save} className="flex items-center gap-1 rounded bg-sage-600 px-2 py-1 text-xs text-white hover:bg-sage-500 disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-3 w-3" /> Save</button>
                        </div>
                    </div>
                ) : (
                    <div className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black p-2.5 pr-9">
                        <div className={`truncate text-sm font-medium text-sage-200 ${presentation.isHashFallback ? 'font-mono' : 'font-sans'}`} title={presentation.value}>
                            {presentation.isHashFallback ? presentation.value : formatModelName(presentation.value)}
                        </div>
                        {presentation.isHashFallback ? <span title="The model name has not been resolved yet" className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">Unresolved hash</span> : null}
                    </div>
                )}
            </div>
        </MetadataField>
    );
};
