import * as React from 'react';
import { Search } from 'lucide-react';
import type { SearchHits } from './graphReading';

interface GraphSearchProps {
    inputRef: React.RefObject<HTMLInputElement | null>;
    query: string;
    hits: SearchHits | null;
    onQuery: (query: string) => void;
    /** Flies to a result and selects it; the search then ends. */
    onPick: (id: string) => void;
    /** Escape in the box: the search ends and focus goes back to the graph. */
    onDone: () => void;
}

const LIST_ID = 'wg-search-results';

/** "/" finds a node by its title, type or settings. The text is never saved. */
export const GraphSearch: React.FC<GraphSearchProps> = ({ inputRef, query, hits, onQuery, onPick, onDone }) => {
    // The highlighted result belongs to the query it was moved on; a new query starts at the top.
    const [activeFor, setActiveFor] = React.useState({ query, index: 0 });
    const active = activeFor.query === query ? activeFor.index : 0;
    const setActive = (move: (index: number) => number) => setActiveFor({ query, index: move(active) });
    const [open, setOpen] = React.useState(false);
    const results = hits?.results ?? [];
    const showList = open && query.trim() !== '';

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onDone();
        } else if (event.key === 'ArrowDown' && results.length > 0) {
            event.preventDefault();
            setActive((index) => (index + 1) % results.length);
        } else if (event.key === 'ArrowUp' && results.length > 0) {
            event.preventDefault();
            setActive((index) => (index - 1 + results.length) % results.length);
        } else if (event.key === 'Enter' && results[active]) {
            event.preventDefault();
            onPick(results[active].id);
        }
    };

    return (
        <div className="wg-search">
            <Search aria-hidden="true" className="ic h-3.5 w-3.5" />
            <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-label="Find a node or value"
                aria-expanded={showList}
                aria-controls={LIST_ID}
                aria-autocomplete="list"
                aria-activedescendant={showList && results[active] ? `${LIST_ID}-${active}` : undefined}
                placeholder="Find a node or value"
                spellCheck={false}
                autoComplete="off"
                value={query}
                onChange={(event) => {
                    onQuery(event.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={handleKeyDown}
            />
            {query === '' ? (
                <kbd className="wg-kbd" aria-hidden="true">
                    /
                </kbd>
            ) : null}
            {showList ? (
                <div id={LIST_ID} className="wg-results wg-frost" role="listbox" aria-label="Matching nodes">
                    {results.length === 0 ? (
                        <div className="wg-empty">No node matches.</div>
                    ) : (
                        results.map((result, index) => (
                            <div
                                key={result.id}
                                id={`${LIST_ID}-${index}`}
                                role="option"
                                aria-selected={index === active}
                                className={index === active ? 'wg-res on' : 'wg-res'}
                                // Picked on press, before the box loses focus and closes the list.
                                onPointerDown={(event) => {
                                    event.preventDefault();
                                    onPick(result.id);
                                }}
                            >
                                <span className="t">{result.title}</span>
                                <span className="d">{result.detail}</span>
                            </div>
                        ))
                    )}
                    {hits && hits.total > results.length ? (
                        <div className="wg-more">{hits.total - results.length} more: type more to narrow</div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};
