import * as React from 'react';
import { BookOpen, History } from 'lucide-react';
import type { SearchQueryIssue } from '../../../utils/searchQueryReadiness';

export interface SearchBarOption {
    id: string;
    kind: 'operator' | 'recent';
    value: string;
    description?: string;
}

interface SearchBarPopoverProps {
    activeOptionIndex: number;
    helperId: string;
    helperText: string;
    listboxId: string;
    listLabel: string;
    options: readonly SearchBarOption[];
    queryIssue: SearchQueryIssue | null;
    statusId: string;
    statusMessage: string | null;
    onClearRecentSearches: () => void;
    onOpenSearchHelp: () => void;
    onSelectOption: (option: SearchBarOption) => void;
}

export const SearchBarPopover = React.memo(({
    activeOptionIndex,
    helperId,
    helperText,
    listboxId,
    listLabel,
    options,
    queryIssue,
    statusId,
    statusMessage,
    onClearRecentSearches,
    onOpenSearchHelp,
    onSelectOption,
}: SearchBarPopoverProps) => (
    <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
        {queryIssue ? (
            <div
                id={statusId}
                role="status"
                aria-live="polite"
                className={`px-4 py-2 text-xs border-b ${queryIssue.kind === 'invalid' ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-red-100 dark:border-red-900/40' : 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-900/40'}`}
            >
                {queryIssue.message}
            </div>
        ) : statusMessage ? (
            <div id={statusId} role="status" aria-live="polite" className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-black/20 border-b border-gray-100 dark:border-white/5">
                {statusMessage}
            </div>
        ) : null}

        {options.length > 0 ? (
            <div className="py-2">
                <div className="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider flex justify-between items-center">
                    <span>{options[0].kind === 'recent' ? 'Recent Searches' : 'Suggestions'}</span>
                    {options[0].kind === 'recent' ? (
                        <button
                            type="button"
                            onClick={onClearRecentSearches}
                            className="hover:text-red-500 transition-colors uppercase"
                        >
                            Clear recent searches
                        </button>
                    ) : null}
                </div>
                <div id={listboxId} role="listbox" aria-label={listLabel}>
                    {options.map((option, index) => (
                        <button
                            key={`${option.kind}-${option.value}`}
                            id={option.id}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={activeOptionIndex === index}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => onSelectOption(option)}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${activeOptionIndex === index ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-900 dark:text-sage-100' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'}`}
                        >
                            {option.kind === 'recent' ? <History aria-hidden="true" className="w-3 h-3 text-gray-400" /> : null}
                            <span className={option.kind === 'operator' ? 'font-mono' : undefined}>{option.value}</span>
                            {option.description ? <span className="ml-auto text-xs text-gray-400 truncate">{option.description}</span> : null}
                        </button>
                    ))}
                </div>
            </div>
        ) : null}

        <div className="border-t border-gray-100 dark:border-white/5 px-3 py-2 flex items-center justify-between gap-3">
            <span id={helperId} className="text-[10px] text-gray-400">
                {statusMessage === helperText ? 'Search syntax opens standard query operators.' : helperText}
            </span>
            <button
                type="button"
                onClick={onOpenSearchHelp}
                className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-sage-600 hover:text-sage-800 dark:text-sage-400 dark:hover:text-sage-200"
            >
                <BookOpen aria-hidden="true" className="w-3 h-3" />
                Search syntax
            </button>
        </div>
    </div>
));
