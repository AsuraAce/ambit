import { getAdvancedDateSearchReadiness } from './dateFilters';

export type SearchQueryIssueKind = 'pending' | 'invalid';

export interface SearchQueryIssue {
    kind: SearchQueryIssueKind;
    message: string;
    token?: string;
}

export interface SearchQueryReadiness {
    isReady: boolean;
    issue: SearchQueryIssue | null;
}

interface SearchQueryToken {
    term: string;
    isNegative: boolean;
    isQuoted: boolean;
    isOrOperator: boolean;
}

const INTEGER_COMPARISON_KEYS = new Set(['steps', 'w', 'width', 'h', 'height']);
const DECIMAL_COMPARISON_KEYS = new Set(['cfg']);
const DATE_KEYS = new Set(['date', 'after', 'before']);
const INTEGER_COMPARISON_PATTERN = /^[<>]?\d+$/;
const DECIMAL_COMPARISON_PATTERN = /^[<>]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const PENDING_DECIMAL_COMPARISON_PATTERN = /^[<>]?(?:\d+\.?|\.?)$/;
const DIGITS_PATTERN = /^\d+$/;

const isFiniteComparisonValue = (value: string): boolean => (
    Number.isFinite(Number(value.replace(/^[<>]/, '')))
);

const isSafeIntegerComparisonValue = (value: string): boolean => (
    Number.isSafeInteger(Number(value.replace(/^[<>]/, '')))
);

const hasUnfinishedQuote = (query: string): boolean => {
    let isEscaped = false;
    let isOpen = false;

    for (const character of query) {
        if (isEscaped) {
            isEscaped = false;
            continue;
        }
        if (character === '\\') {
            isEscaped = true;
            continue;
        }
        if (character === '"') isOpen = !isOpen;
    }

    return isOpen;
};

const tokenizeSearchQuery = (query: string): SearchQueryToken[] => {
    const tokens: SearchQueryToken[] = [];
    const termPattern = /(-|!)?("(?:[^"\\]|\\.)*"|\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = termPattern.exec(query)) !== null) {
        const rawTerm = match[2];
        const isQuoted = rawTerm.startsWith('"') && rawTerm.endsWith('"');
        const term = isQuoted ? rawTerm.slice(1, -1) : rawTerm;
        tokens.push({
            term,
            isNegative: Boolean(match[1]),
            isQuoted,
            isOrOperator: !match[1] && !isQuoted && term.toUpperCase() === 'OR',
        });
    }

    return tokens;
};

const createIssue = (
    kind: SearchQueryIssueKind,
    message: string,
    token?: string
): SearchQueryReadiness => ({
    isReady: false,
    issue: { kind, message, token },
});

const isPositivePromptOperand = (token: SearchQueryToken | undefined): boolean => Boolean(
    token
    && !token.isNegative
    && !token.isOrOperator
    && (token.isQuoted || !token.term.includes(':'))
    && token.term.length > 0
);

export const canAppendPromptOr = (query: string): boolean => {
    if (hasUnfinishedQuote(query)) return false;
    const tokens = tokenizeSearchQuery(query);
    return isPositivePromptOperand(tokens.at(-1));
};

export const getSearchQueryReadiness = (query: string): SearchQueryReadiness => {
    if (hasUnfinishedQuote(query)) {
        return createIssue('pending', 'Finish the quoted phrase before searching.');
    }

    const dateReadiness = getAdvancedDateSearchReadiness(query);
    if (!dateReadiness.isReady) {
        return createIssue(
            dateReadiness.issue ?? 'invalid',
            'Use ISO dates like date:2026-04 or before:2025.',
            dateReadiness.token
        );
    }

    const tokens = tokenizeSearchQuery(query);

    for (const token of tokens) {
        if (token.isQuoted || token.isOrOperator || token.term.startsWith(':') || !token.term.includes(':')) {
            continue;
        }

        const separatorIndex = token.term.indexOf(':');
        const key = token.term.slice(0, separatorIndex).toLowerCase();
        const value = token.term.slice(separatorIndex + 1);

        if (!value) {
            return createIssue('pending', `Add a value after ${key}:`, token.term);
        }
        if (DATE_KEYS.has(key)) continue;

        if (
            INTEGER_COMPARISON_KEYS.has(key)
            && (!INTEGER_COMPARISON_PATTERN.test(value) || !isSafeIntegerComparisonValue(value))
        ) {
            return createIssue(
                value === '<' || value === '>' ? 'pending' : 'invalid',
                `Use ${key}:30, ${key}:>30, or ${key}:<30.`,
                token.term
            );
        }
        if (
            DECIMAL_COMPARISON_KEYS.has(key)
            && (!DECIMAL_COMPARISON_PATTERN.test(value) || !isFiniteComparisonValue(value))
        ) {
            const isPendingDecimal = !DECIMAL_COMPARISON_PATTERN.test(value)
                && PENDING_DECIMAL_COMPARISON_PATTERN.test(value);
            return createIssue(
                isPendingDecimal ? 'pending' : 'invalid',
                `Use ${key}:7, ${key}:>7, or ${key}:<7.`,
                token.term
            );
        }
        if (key === 'seed' && !DIGITS_PATTERN.test(value)) {
            return createIssue('invalid', 'Use seed: followed by digits.', token.term);
        }
        if (key === 'upscaled' && value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false') {
            const normalizedValue = value.toLowerCase();
            const isPendingBoolean = 'true'.startsWith(normalizedValue) || 'false'.startsWith(normalizedValue);
            return createIssue(
                isPendingBoolean ? 'pending' : 'invalid',
                'Use upscaled:true or upscaled:false.',
                token.term
            );
        }
    }

    for (let index = 0; index < tokens.length; index += 1) {
        if (!tokens[index].isOrOperator) continue;

        if (index === tokens.length - 1 && isPositivePromptOperand(tokens[index - 1])) {
            return createIssue('pending', 'Add a positive prompt term after OR.', tokens[index].term);
        }
        if (!isPositivePromptOperand(tokens[index - 1]) || !isPositivePromptOperand(tokens[index + 1])) {
            return createIssue('invalid', 'Use OR between two positive prompt terms.', tokens[index].term);
        }
    }

    return { isReady: true, issue: null };
};
