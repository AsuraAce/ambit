import { describe, expect, it } from 'vitest';
import { render } from '../../../../test/testUtils';
import { HighlightedPromptText } from '../../components/metadata/HighlightedPromptText';
import { derivePromptHighlightSpec } from '../searchHighlights';

describe('derivePromptHighlightSpec', () => {
    it('returns no highlights for empty and one-character terms', () => {
        expect(derivePromptHighlightSpec('   ')).toEqual({ positivePrompt: [], negativePrompt: [] });
        expect(derivePromptHighlightSpec('a neg:b')).toEqual({ positivePrompt: [], negativePrompt: [] });
    });

    it('highlights plain terms in the positive prompt', () => {
        expect(derivePromptHighlightSpec('sunset')).toEqual({
            positivePrompt: ['sunset'],
            negativePrompt: []
        });
    });

    it('highlights quoted phrases in the positive prompt', () => {
        expect(derivePromptHighlightSpec('"golden hour"')).toEqual({
            positivePrompt: ['golden hour'],
            negativePrompt: []
        });
    });

    it('highlights neg and negative operators in the negative prompt', () => {
        expect(derivePromptHighlightSpec('neg:blur negative:watermark')).toEqual({
            positivePrompt: [],
            negativePrompt: ['blur', 'watermark']
        });
    });

    it('skips excluded terms', () => {
        expect(derivePromptHighlightSpec('-bird !cat')).toEqual({
            positivePrompt: [],
            negativePrompt: []
        });
    });

    it('skips non-prompt operators', () => {
        expect(derivePromptHighlightSpec('model:flux file:portrait all:anime steps:>30')).toEqual({
            positivePrompt: [],
            negativePrompt: []
        });
    });

    it('dedupes terms case-insensitively per prompt field', () => {
        expect(derivePromptHighlightSpec('Sunset sunset neg:Blur negative:blur')).toEqual({
            positivePrompt: ['Sunset'],
            negativePrompt: ['Blur']
        });
    });
});

describe('HighlightedPromptText', () => {
    it('renders matching terms inside mark elements', () => {
        const { container } = render(
            <div>
                <HighlightedPromptText text="cinematic sunset over water" terms={['sunset']} />
            </div>
        );

        const mark = container.querySelector('mark');
        expect(mark?.textContent).toBe('sunset');
        expect(container.textContent).toBe('cinematic sunset over water');
    });

    it('keeps unmatched prompt text visible and ordered', () => {
        const { container } = render(
            <div>
                <HighlightedPromptText text="golden hour portrait, soft rim light" terms={['portrait']} />
            </div>
        );

        expect(container.textContent).toBe('golden hour portrait, soft rim light');
    });

    it('treats special regex characters as literal text', () => {
        const { container } = render(
            <div>
                <HighlightedPromptText text="literal c++ prompt with [brackets]" terms={['c++', '[brackets]']} />
            </div>
        );

        const marks = Array.from(container.querySelectorAll('mark')).map(mark => mark.textContent);
        expect(marks).toEqual(['c++', '[brackets]']);
    });

    it('renders plain text when terms are empty, too short, duplicate, or unmatched', () => {
        const { container, rerender } = render(
            <div><HighlightedPromptText text="plain prompt" /></div>
        );
        expect(container.querySelector('mark')).toBeNull();

        rerender(
            <div>
                <HighlightedPromptText text="plain prompt" terms={[' ', 'p', 'MISSING', 'missing']} />
            </div>
        );
        expect(container.textContent).toBe('plain prompt');
        expect(container.querySelector('mark')).toBeNull();

        rerender(<div><HighlightedPromptText text="" terms={['prompt']} /></div>);
        expect(container.textContent).toBe('');
    });

    it('prefers the longest overlapping term and highlights repeated boundary matches', () => {
        const { container } = render(
            <div>
                <HighlightedPromptText
                    text="foobar middle foobar"
                    terms={['foo', 'FOOBAR', 'bar']}
                />
            </div>
        );

        expect(Array.from(container.querySelectorAll('mark')).map(mark => mark.textContent)).toEqual([
            'foobar',
            'foobar',
        ]);
        expect(container.textContent).toBe('foobar middle foobar');
    });
});
