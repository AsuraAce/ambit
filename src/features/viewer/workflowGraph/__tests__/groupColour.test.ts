import { describe, expect, it } from 'vitest';
import { groupColour } from '../groupColour';

describe('group colours', () => {
    it('maps ComfyUI presets to Quiet tokens, short or long form', () => {
        expect(groupColour('#3f789e', 'quiet')).toBe('var(--group-pale-blue)');
        expect(groupColour('#A88', 'quiet')).toBe('var(--group-red)');
        expect(groupColour('#aa8888', 'quiet')).toBe('var(--group-red)');
    });

    it('shows an unknown hex as neutral in Quiet and as itself in Familiar', () => {
        expect(groupColour('#123456', 'quiet')).toBe('var(--group-neutral)');
        expect(groupColour('#123456', 'familiar')).toBe('#123456');
    });

    // A group colour lands in an inline style: anything but plain hex could carry CSS of its own.
    it.each(['red', '#12345', 'var(--graph-text)', '#fff; background: url(https://x)', 'url(x)', '#ggg', '', null])(
        'treats %j as neutral in both palettes',
        (value) => {
            expect(groupColour(value, 'quiet')).toBe('var(--group-neutral)');
            const familiar = groupColour(value, 'familiar');
            expect(familiar === 'var(--group-neutral)' || /^#[0-9a-fA-F]{3,8}$/.test(familiar)).toBe(true);
            if (value && !/^#[0-9a-fA-F]{3,8}$/.test(value)) expect(familiar).toBe('var(--group-neutral)');
        }
    );
});
