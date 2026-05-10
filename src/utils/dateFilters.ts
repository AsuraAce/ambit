import { FilterState } from '../types';

export interface DateFilterBounds {
    start?: number;
    end?: number;
}

export type AdvancedDateSearchIssue = 'pending' | 'invalid';

export interface AdvancedDateSearchReadiness {
    isReady: boolean;
    issue: AdvancedDateSearchIssue | null;
    token?: string;
}

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_YEAR_PATTERN = /^\d{4}$/;
const SEARCH_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const PENDING_SEARCH_YEAR_PATTERN = /^\d{1,3}$/;
const PENDING_SEARCH_MONTH_PATTERN = /^\d{4}-(?:\d?)$/;
const PENDING_SEARCH_DAY_PATTERN = /^\d{4}-\d{2}-(?:\d?)$/;
const ADVANCED_DATE_SEARCH_KEYS = new Set(['date', 'after', 'before']);

interface SearchDatePeriod {
    start: number;
    end: number;
}

export const DATE_PRESETS = ['all', 'today', 'week', 'month'] as const;

export const formatDateInputValue = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const createLocalDate = (year: number, monthIndex: number, day: number): Date => {
    const date = new Date(0);
    date.setFullYear(year, monthIndex, day);
    date.setHours(0, 0, 0, 0);
    return date;
};

export const isValidDateInput = (value: string | undefined): value is string => {
    if (!value || !DATE_INPUT_PATTERN.test(value)) return false;

    const [year, month, day] = value.split('-').map(Number);
    const date = createLocalDate(year, month - 1, day);

    return date.getFullYear() === year
        && date.getMonth() === month - 1
        && date.getDate() === day;
};

export const compareDateInputs = (left: string, right: string): number => {
    const leftStart = parseDateInputStart(left);
    const rightStart = parseDateInputStart(right);
    if (leftStart === null || rightStart === null) return 0;
    return leftStart - rightStart;
};

const startOfLocalDay = (date: Date): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addLocalDays = (date: Date, days: number): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const parseDateInputStart = (value: string | undefined): number | null => {
    if (!isValidDateInput(value)) return null;

    const [year, month, day] = value.split('-').map(Number);
    return createLocalDate(year, month - 1, day).getTime();
};

const nextLocalMidnight = (startTimestamp: number): number =>
    addLocalDays(new Date(startTimestamp), 1).getTime();

const buildDateInputBounds = (
    dateFrom: string | undefined,
    dateTo: string | undefined
): DateFilterBounds => {
    const fromStart = parseDateInputStart(dateFrom);
    const toStart = parseDateInputStart(dateTo);

    if (fromStart !== null && toStart !== null) {
        if (fromStart <= toStart) {
            return { start: fromStart, end: nextLocalMidnight(toStart) };
        }

        return { start: toStart, end: nextLocalMidnight(fromStart) };
    }

    if (fromStart !== null) return { start: fromStart };
    if (toStart !== null) return { end: nextLocalMidnight(toStart) };

    return {};
};

const parseSearchDatePeriod = (value: string | undefined): SearchDatePeriod | null => {
    if (!value) return null;

    const normalizedValue = value.trim();

    if (DATE_INPUT_PATTERN.test(normalizedValue)) {
        const start = parseDateInputStart(normalizedValue);
        return start === null ? null : { start, end: nextLocalMidnight(start) };
    }

    if (SEARCH_MONTH_PATTERN.test(normalizedValue)) {
        const [year, month] = normalizedValue.split('-').map(Number);
        if (month < 1 || month > 12) return null;

        return {
            start: createLocalDate(year, month - 1, 1).getTime(),
            end: createLocalDate(year, month, 1).getTime()
        };
    }

    if (SEARCH_YEAR_PATTERN.test(normalizedValue)) {
        const year = Number(normalizedValue);
        return {
            start: createLocalDate(year, 0, 1).getTime(),
            end: createLocalDate(year + 1, 0, 1).getTime()
        };
    }

    return null;
};

const buildSearchDateRangeBounds = (
    dateFrom: string | undefined,
    dateTo: string | undefined
): DateFilterBounds | null => {
    if (!dateFrom || !dateTo) return null;

    const fromPeriod = parseSearchDatePeriod(dateFrom);
    const toPeriod = parseSearchDatePeriod(dateTo);

    if (fromPeriod && toPeriod) {
        return {
            start: Math.min(fromPeriod.start, toPeriod.start),
            end: Math.max(fromPeriod.end, toPeriod.end)
        };
    }

    return null;
};

export const normalizeDateInputPair = (
    dateFrom: string | undefined,
    dateTo: string | undefined
): Pick<FilterState, 'dateFrom' | 'dateTo'> => {
    const normalizedFrom = isValidDateInput(dateFrom) ? dateFrom : undefined;
    const normalizedTo = isValidDateInput(dateTo) ? dateTo : undefined;

    if (normalizedFrom && normalizedTo && compareDateInputs(normalizedFrom, normalizedTo) > 0) {
        return { dateFrom: normalizedTo, dateTo: normalizedFrom };
    }

    return { dateFrom: normalizedFrom, dateTo: normalizedTo };
};

export const getDateFilterBounds = (
    filters: Pick<FilterState, 'dateRange' | 'dateFrom' | 'dateTo'>,
    now: Date = new Date()
): DateFilterBounds => {
    const todayStart = startOfLocalDay(now);

    if (filters.dateRange === 'today') {
        return { start: todayStart.getTime() };
    }

    if (filters.dateRange === 'week') {
        return { start: addLocalDays(todayStart, -7).getTime() };
    }

    if (filters.dateRange === 'month') {
        return { start: addLocalDays(todayStart, -30).getTime() };
    }

    if (filters.dateRange === 'custom') {
        return buildDateInputBounds(filters.dateFrom, filters.dateTo);
    }

    return {};
};

export const getSearchDateBounds = (key: string, value: string): DateFilterBounds | null => {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = value.trim();

    if (normalizedKey === 'date') {
        if (normalizedValue.includes('..')) {
            const dateRangeParts = normalizedValue.split('..');
            if (dateRangeParts.length !== 2) return null;

            const [dateFrom, dateTo] = dateRangeParts;
            const bounds = buildSearchDateRangeBounds(
                dateFrom.trim() || undefined,
                dateTo.trim() || undefined
            );
            return bounds;
        }

        const period = parseSearchDatePeriod(normalizedValue);
        return period ? { start: period.start, end: period.end } : null;
    }

    if (normalizedKey === 'after') {
        const period = parseSearchDatePeriod(normalizedValue);
        return period ? { start: period.start } : null;
    }

    if (normalizedKey === 'before') {
        const period = parseSearchDatePeriod(normalizedValue);
        return period ? { end: period.end } : null;
    }

    return null;
};

const isPendingSearchDateAtom = (value: string): boolean => (
    PENDING_SEARCH_YEAR_PATTERN.test(value) ||
    PENDING_SEARCH_MONTH_PATTERN.test(value) ||
    PENDING_SEARCH_DAY_PATTERN.test(value)
);

const getSearchDateAtomIssue = (key: string, value: string): AdvancedDateSearchIssue | null => {
    const normalizedValue = value.trim();
    if (!normalizedValue) return 'pending';
    if (getSearchDateBounds(key, normalizedValue)) return null;
    return isPendingSearchDateAtom(normalizedValue) ? 'pending' : 'invalid';
};

const getSearchDateValueIssue = (key: string, value: string): AdvancedDateSearchIssue | null => {
    const normalizedValue = value.trim();
    if (!normalizedValue) return 'pending';

    if (key === 'date' && normalizedValue.includes('..')) {
        const parts = normalizedValue.split('..');
        if (parts.length !== 2) return 'invalid';

        const [dateFrom, dateTo] = parts.map(part => part.trim());
        if (!dateFrom || !dateTo) return 'pending';

        const fromIssue = getSearchDateAtomIssue('date', dateFrom);
        const toIssue = getSearchDateAtomIssue('date', dateTo);
        if (fromIssue === 'invalid' || toIssue === 'invalid') return 'invalid';
        if (fromIssue === 'pending' || toIssue === 'pending') return 'pending';
        return null;
    }

    return getSearchDateAtomIssue(key, normalizedValue);
};

export const getAdvancedDateSearchReadiness = (query: string): AdvancedDateSearchReadiness => {
    const termRegex = /(-|!)?("(?:[^"\\]|\\.)*"|\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = termRegex.exec(query)) !== null) {
        const rawTerm = match[2];
        const isQuoted = rawTerm.startsWith('"') && rawTerm.endsWith('"');
        if (isQuoted || rawTerm.startsWith(':') || !rawTerm.includes(':')) continue;

        const separatorIndex = rawTerm.indexOf(':');
        const key = rawTerm.slice(0, separatorIndex).toLowerCase();
        if (!ADVANCED_DATE_SEARCH_KEYS.has(key)) continue;

        const value = rawTerm.slice(separatorIndex + 1);
        const issue = getSearchDateValueIssue(key, value);
        if (issue) {
            return {
                isReady: false,
                issue,
                token: rawTerm
            };
        }
    }

    return { isReady: true, issue: null };
};

export const timestampMatchesDateBounds = (
    timestamp: number,
    bounds: DateFilterBounds
): boolean => {
    if (bounds.start !== undefined && timestamp < bounds.start) return false;
    if (bounds.end !== undefined && timestamp >= bounds.end) return false;
    return true;
};

const formatDisplayDate = (value: string): string => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
};

const presetLabel = (range: FilterState['dateRange']): string | null => {
    if (range === 'today') return 'Date: Today';
    if (range === 'week') return 'Date: Week';
    if (range === 'month') return 'Date: Month';
    return null;
};

export const getDateFilterLabel = (
    filters: Pick<FilterState, 'dateRange' | 'dateFrom' | 'dateTo'>
): string | null => {
    if (filters.dateRange !== 'custom') {
        return presetLabel(filters.dateRange);
    }

    const { dateFrom, dateTo } = normalizeDateInputPair(filters.dateFrom, filters.dateTo);
    const formattedFrom = dateFrom ? formatDisplayDate(dateFrom) : null;
    const formattedTo = dateTo ? formatDisplayDate(dateTo) : null;

    if (formattedFrom && formattedTo) {
        return formattedFrom === formattedTo
            ? `Date: ${formattedFrom}`
            : `Date: ${formattedFrom} to ${formattedTo}`;
    }

    if (formattedFrom) return `Date: From ${formattedFrom}`;
    if (formattedTo) return `Date: Until ${formattedTo}`;

    return null;
};
