import { describe, expect, it } from 'vitest';
import {
    compareDateInputs,
    getAdvancedDateSearchReadiness,
    getDateFilterBounds,
    getDateFilterLabel,
    getSearchDateBounds,
    timestampMatchesDateBounds
} from '../dateFilters';

describe('dateFilters', () => {
    it('formats custom range labels', () => {
        expect(getDateFilterLabel({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30'
        })).toBe('Date: Apr 1, 2026 to Apr 30, 2026');
    });

    it('resolves custom ranges as local inclusive calendar days', () => {
        const bounds = getDateFilterBounds({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30'
        });

        expect(bounds).toEqual({
            start: new Date(2026, 3, 1).getTime(),
            end: new Date(2026, 4, 1).getTime()
        });
        expect(timestampMatchesDateBounds(new Date(2026, 3, 30, 23, 59).getTime(), bounds)).toBe(true);
        expect(timestampMatchesDateBounds(new Date(2026, 4, 1).getTime(), bounds)).toBe(false);
    });

    it('parses advanced search date bounds', () => {
        expect(getSearchDateBounds('date', '2025')).toEqual({
            start: new Date(2025, 0, 1).getTime(),
            end: new Date(2026, 0, 1).getTime()
        });
        expect(getSearchDateBounds('date', '2026-04')).toEqual({
            start: new Date(2026, 3, 1).getTime(),
            end: new Date(2026, 4, 1).getTime()
        });
        expect(getSearchDateBounds('date', '2026-04-15')).toEqual({
            start: new Date(2026, 3, 15).getTime(),
            end: new Date(2026, 3, 16).getTime()
        });
        expect(getSearchDateBounds('date', '2025..2026-04')).toEqual({
            start: new Date(2025, 0, 1).getTime(),
            end: new Date(2026, 4, 1).getTime()
        });
        expect(getSearchDateBounds('date', '2026-04..2025')).toEqual({
            start: new Date(2025, 0, 1).getTime(),
            end: new Date(2026, 4, 1).getTime()
        });
        expect(getSearchDateBounds('after', '2026')).toEqual({
            start: new Date(2026, 0, 1).getTime()
        });
        expect(getSearchDateBounds('after', '2026-04')).toEqual({
            start: new Date(2026, 3, 1).getTime()
        });
        expect(getSearchDateBounds('before', '2026')).toEqual({
            end: new Date(2027, 0, 1).getTime()
        });
        expect(getSearchDateBounds('before', '2026-04')).toEqual({
            end: new Date(2026, 4, 1).getTime()
        });
        expect(getSearchDateBounds('before', '2026-04-30')).toEqual({
            end: new Date(2026, 4, 1).getTime()
        });
    });

    it('rejects ambiguous or invalid advanced search date bounds', () => {
        expect(getSearchDateBounds('date', '2026-13')).toBeNull();
        expect(getSearchDateBounds('date', '2026-02-30')).toBeNull();
        expect(getSearchDateBounds('date', '2025..2026-13')).toBeNull();
        expect(getSearchDateBounds('date', '2026-13..2027')).toBeNull();
        expect(getSearchDateBounds('date', '2025..')).toBeNull();
        expect(getSearchDateBounds('date', '..2026')).toBeNull();
        expect(getSearchDateBounds('date', '04/05/2026')).toBeNull();
        expect(getSearchDateBounds('date', 'june-2024')).toBeNull();
    });

    it('flags incomplete advanced date search syntax as not ready', () => {
        ['date:', 'date:2026-', 'date:2026..'].forEach(query => {
            expect(getAdvancedDateSearchReadiness(query)).toMatchObject({
                isReady: false,
                issue: 'pending'
            });
        });
    });

    it('flags invalid advanced date search syntax as not ready', () => {
        ['date:2026-13', 'before:june-2024', 'after:04/05/2026'].forEach(query => {
            expect(getAdvancedDateSearchReadiness(query)).toMatchObject({
                isReady: false,
                issue: 'invalid'
            });
        });
    });

    it('allows valid advanced date search syntax to commit', () => {
        [
            'date:2025',
            'date:2026-04',
            'date:2026-04-15',
            'date:2025..2026-04',
            'portrait after:2026-04'
        ].forEach(query => {
            expect(getAdvancedDateSearchReadiness(query)).toEqual({ isReady: true, issue: null });
        });
    });

    it('handles empty, preset, and reversed custom filter bounds', () => {
        const now = new Date(2026, 6, 12, 15);

        expect(getDateFilterBounds({ dateRange: 'custom' }, now)).toEqual({});
        expect(getDateFilterBounds({ dateRange: 'month' }, now)).toEqual({
            start: new Date(2026, 5, 12).getTime()
        });
        expect(getDateFilterBounds({
            dateRange: 'custom',
            dateFrom: '2026-04-30',
            dateTo: '2026-04-01'
        }, now)).toEqual({
            start: new Date(2026, 3, 1).getTime(),
            end: new Date(2026, 4, 1).getTime()
        });
        expect(compareDateInputs('invalid', '2026-04-01')).toBe(0);
    });

    it('rejects malformed date ranges and classifies mixed atom issues', () => {
        expect(getSearchDateBounds('date', '2025..2026..2027')).toBeNull();
        expect(getAdvancedDateSearchReadiness('date:2026-..2027')).toMatchObject({
            isReady: false,
            issue: 'pending'
        });
        expect(getAdvancedDateSearchReadiness('date:2026-13..2027')).toMatchObject({
            isReady: false,
            issue: 'invalid'
        });
        expect(getAdvancedDateSearchReadiness('date:2026..2027-')).toMatchObject({
            isReady: false,
            issue: 'pending'
        });
        expect(getAdvancedDateSearchReadiness('date:2026..2027..2028')).toMatchObject({
            isReady: false,
            issue: 'invalid'
        });
    });

    it('formats preset, same-day, and one-sided labels', () => {
        expect(getDateFilterLabel({ dateRange: 'today' })).toBe('Date: Today');
        expect(getDateFilterLabel({ dateRange: 'week' })).toBe('Date: Week');
        expect(getDateFilterLabel({ dateRange: 'month' })).toBe('Date: Month');
        expect(getDateFilterLabel({ dateRange: 'all' })).toBeNull();
        expect(getDateFilterLabel({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-01'
        })).toBe('Date: Apr 1, 2026');
        expect(getDateFilterLabel({ dateRange: 'custom', dateFrom: '2026-04-01' }))
            .toBe('Date: From Apr 1, 2026');
        expect(getDateFilterLabel({ dateRange: 'custom', dateTo: '2026-04-30' }))
            .toBe('Date: Until Apr 30, 2026');
        expect(getDateFilterLabel({ dateRange: 'custom' })).toBeNull();
    });
});
