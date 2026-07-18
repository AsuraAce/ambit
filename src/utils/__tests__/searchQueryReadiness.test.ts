import { describe, expect, it } from 'vitest';
import { canAppendPromptOr, getSearchQueryReadiness } from '../searchQueryReadiness';

describe('getSearchQueryReadiness', () => {
    it.each([
        '',
        'forest portrait',
        '"dark elf"',
        'steps:30 cfg:7.5 width:1024 height:>512',
        'seed:123 upscaled:false',
        'date:2026-04 before:2025',
        'forest OR ocean OR sky',
        'unknown:value',
        '"artist:name"',
    ])('allows ready query %s', query => {
        expect(getSearchQueryReadiness(query)).toEqual({ isReady: true, issue: null });
    });

    it.each([
        ['"unfinished', 'Finish the quoted phrase before searching.'],
        ['model:', 'Add a value after model:'],
        ['date:2026-', 'Use ISO dates like date:2026-04 or before:2025.'],
        ['steps:>', 'Use steps:30, steps:>30, or steps:<30.'],
        ['cfg:7.', 'Use cfg:7, cfg:>7, or cfg:<7.'],
        ['upscaled:t', 'Use upscaled:true or upscaled:false.'],
        ['forest OR', 'Add a positive prompt term after OR.'],
    ])('marks incomplete query %s as pending', (query, message) => {
        const result = getSearchQueryReadiness(query);
        expect(result.issue).toMatchObject({ kind: 'pending', message });
    });

    it.each([
        ['before:june-2024', 'Use ISO dates like date:2026-04 or before:2025.'],
        ['steps:3.5', 'Use steps:30, steps:>30, or steps:<30.'],
        ['width:large', 'Use width:30, width:>30, or width:<30.'],
        ['cfg:high', 'Use cfg:7, cfg:>7, or cfg:<7.'],
        ['seed:-42', 'Use seed: followed by digits.'],
        ['upscaled:yes', 'Use upscaled:true or upscaled:false.'],
        ['OR forest', 'Use OR between two positive prompt terms.'],
        ['forest OR OR ocean', 'Use OR between two positive prompt terms.'],
        ['forest OR model:flux', 'Use OR between two positive prompt terms.'],
    ])('marks malformed query %s as invalid', (query, message) => {
        const result = getSearchQueryReadiness(query);
        expect(result.issue).toMatchObject({ kind: 'invalid', message });
    });

    it.each([
        `steps:${'9'.repeat(400)}`,
        `cfg:${'9'.repeat(400)}`,
        `width:>${'9'.repeat(400)}`,
    ])('rejects non-finite numeric query %s', query => {
        expect(getSearchQueryReadiness(query).issue?.kind).toBe('invalid');
    });

    it.each([
        'steps:9007199254740993',
        'height:>9007199254740993',
    ])('rejects integer query %s when parsing would lose precision', query => {
        expect(getSearchQueryReadiness(query).issue?.kind).toBe('invalid');
    });

    it('suggests OR only after a positive prompt operand', () => {
        expect(canAppendPromptOr('forest')).toBe(true);
        expect(canAppendPromptOr('forest OR ocean')).toBe(true);
        expect(canAppendPromptOr('model:flux')).toBe(false);
        expect(canAppendPromptOr('-forest')).toBe(false);
        expect(canAppendPromptOr('forest OR')).toBe(false);
        expect(canAppendPromptOr('')).toBe(false);
    });
});
