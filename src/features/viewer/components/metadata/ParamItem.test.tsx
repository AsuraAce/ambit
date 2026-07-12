import { render, screen } from '../../../../test/testUtils';
import { describe, expect, it } from 'vitest';
import { ParamItem } from './ParamItem';

describe('ParamItem', () => {
    it.each([
        ['', {}],
        ['0', {}],
        ['Unknown', {}],
    ])('suppresses non-informative value %s by default', (value, props) => {
        const { container } = render(<ParamItem label="Value" value={value} {...props} />);

        expect(container.textContent).toBe('');
    });

    it('can explicitly display zero and unknown values', () => {
        const { rerender } = render(<ParamItem label="Steps" value="0" allowZero />);
        expect(screen.getByText('0')).toBeTruthy();

        rerender(<ParamItem label="Model" value="Unknown" showUnknown />);
        expect(screen.getByText('Unknown')).toBeTruthy();
    });

    it('marks modified full-width values while defaults remain unmodified', () => {
        const { container, rerender } = render(
            <ParamItem label="Sampler" value="Euler" fullWidth isModified />
        );

        expect(container.firstElementChild?.className).toContain('col-span-2');
        expect(container.firstElementChild?.className).toContain('border-amber-500');
        expect(screen.getByTitle('Modified from original')).toBeTruthy();

        rerender(<ParamItem label="Sampler" value="Euler" />);
        expect(container.firstElementChild?.className).toContain('border-gray-200');
        expect(screen.queryByTitle('Modified from original')).toBeNull();
    });
});
