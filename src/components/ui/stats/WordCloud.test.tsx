import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { WordCloud } from './WordCloud';

describe('WordCloud', () => {
    it('normalizes distinct keyword counts and forwards selection', () => {
        const onWordClick = vi.fn();
        render(<WordCloud
            keywords={[{ text: 'portrait', value: 2 }, { text: 'landscape', value: 8 }]}
            onWordClick={onWordClick}
            totalImages={1234}
        />);

        const portrait = screen.getByRole('button', { name: 'portrait' });
        const landscape = screen.getByRole('button', { name: 'landscape' });
        expect(portrait.style.fontSize).toBe('0.85rem');
        expect(landscape.style.fontSize).toBe('2.35rem');
        expect(screen.getByText('1,234 Generations')).toBeTruthy();

        fireEvent.click(landscape);
        expect(onWordClick).toHaveBeenCalledWith('landscape');
    });

    it('renders loading, empty, and equal-weight states', () => {
        const props = { onWordClick: vi.fn(), totalImages: 0 };
        const { rerender } = render(<WordCloud {...props} keywords={[]} isLoading />);
        expect(screen.getByText('Analyzing Library')).toBeTruthy();

        rerender(<WordCloud {...props} keywords={[]} />);
        expect(screen.getByText('No keywords found')).toBeTruthy();

        rerender(<WordCloud {...props} keywords={[{ text: 'equal', value: 5 }]} />);
        expect(screen.getByRole('button', { name: 'equal' }).style.fontSize).toBe('1rem');
    });
});
