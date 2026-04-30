import type { ReactNode } from 'react';

interface HighlightMatch {
    start: number;
    end: number;
}

interface HighlightedPromptTextProps {
    text: string;
    terms?: string[];
}

const MARK_CLASS_NAME = 'rounded bg-amber-200 px-0.5 text-gray-950 dark:bg-amber-400/30 dark:text-amber-100';

const normalizeTerms = (terms: string[]): string[] => {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const term of terms) {
        const clean = term.trim();
        if (clean.length <= 1) continue;

        const key = clean.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        normalized.push(clean);
    }

    return normalized;
};

const findHighlightMatches = (text: string, terms: string[]): HighlightMatch[] => {
    const normalizedTerms = normalizeTerms(terms);
    if (!text || normalizedTerms.length === 0) return [];

    const lowerText = text.toLowerCase();
    const matches: HighlightMatch[] = [];

    for (const term of normalizedTerms) {
        const lowerTerm = term.toLowerCase();
        let start = lowerText.indexOf(lowerTerm);

        while (start !== -1) {
            matches.push({ start, end: start + lowerTerm.length });
            start = lowerText.indexOf(lowerTerm, start + lowerTerm.length);
        }
    }

    matches.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return (b.end - b.start) - (a.end - a.start);
    });

    const nonOverlapping: HighlightMatch[] = [];
    let lastEnd = -1;

    for (const match of matches) {
        if (match.start < lastEnd) continue;
        nonOverlapping.push(match);
        lastEnd = match.end;
    }

    return nonOverlapping;
};

export const HighlightedPromptText = ({ text, terms = [] }: HighlightedPromptTextProps) => {
    const matches = findHighlightMatches(text, terms);
    if (matches.length === 0) return <>{text}</>;

    const parts: ReactNode[] = [];
    let cursor = 0;

    matches.forEach((match, index) => {
        if (cursor < match.start) {
            parts.push(text.slice(cursor, match.start));
        }

        parts.push(
            <mark key={`${match.start}-${match.end}-${index}`} className={MARK_CLASS_NAME}>
                {text.slice(match.start, match.end)}
            </mark>
        );
        cursor = match.end;
    });

    if (cursor < text.length) {
        parts.push(text.slice(cursor));
    }

    return <>{parts}</>;
};
