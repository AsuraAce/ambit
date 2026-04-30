export interface PromptHighlightSpec {
    positivePrompt: string[];
    negativePrompt: string[];
}

const SEARCH_TERM_REGEX = /(-|!)?("(?:[^"\\]|\\.)*"|\S+)/g;
const NEGATIVE_PROMPT_KEYS = new Set(['neg', 'negative']);

const EMPTY_HIGHLIGHTS: PromptHighlightSpec = {
    positivePrompt: [],
    negativePrompt: []
};

const cleanSearchTerm = (term: string): string => {
    if (term.startsWith('"') && term.endsWith('"')) {
        return term.slice(1, -1).replace(/\\"/g, '"').trim();
    }

    return term.trim();
};

const addUniqueTerm = (terms: string[], seen: Set<string>, term: string) => {
    const clean = cleanSearchTerm(term);
    if (clean.length <= 1) return;

    const key = clean.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    terms.push(clean);
};

export const derivePromptHighlightSpec = (searchQuery: string): PromptHighlightSpec => {
    if (!searchQuery.trim()) return EMPTY_HIGHLIGHTS;

    const highlights: PromptHighlightSpec = {
        positivePrompt: [],
        negativePrompt: []
    };
    const seenPositive = new Set<string>();
    const seenNegative = new Set<string>();

    for (const match of searchQuery.matchAll(SEARCH_TERM_REGEX)) {
        const prefix = match[1];
        const rawTerm = match[2];
        if (!rawTerm || prefix === '-' || prefix === '!') continue;

        const cleanTerm = cleanSearchTerm(rawTerm);
        const lowerTerm = cleanTerm.toLowerCase();

        if (lowerTerm.includes(':') && !lowerTerm.startsWith(':')) {
            const separatorIndex = cleanTerm.indexOf(':');
            const key = cleanTerm.slice(0, separatorIndex).toLowerCase();
            const value = cleanTerm.slice(separatorIndex + 1);

            if (NEGATIVE_PROMPT_KEYS.has(key)) {
                addUniqueTerm(highlights.negativePrompt, seenNegative, value);
            }

            continue;
        }

        addUniqueTerm(highlights.positivePrompt, seenPositive, cleanTerm);
    }

    return highlights;
};
