import { describe, expect, it } from 'vitest';
import { formatCount, formatCountCompact, formatModelName } from '../formatUtils';

describe('formatUtils', () => {
    it('formats raw and abbreviated counts for dense UI labels', () => {
        expect(formatCount(850)).toBe('850');
        expect(formatCount(1_200)).toBe('1.2k');
        expect(formatCount(22_400)).toBe('22.4k');
        expect(formatCount(1_200_000)).toBe('1.2M');
    });

    it('drops unnecessary decimals in compact count labels', () => {
        expect(formatCountCompact(999)).toBe('999');
        expect(formatCountCompact(1_000)).toBe('1k');
        expect(formatCountCompact(1_250)).toBe('1.3k');
        expect(formatCountCompact(2_000_000)).toBe('2M');
    });

    it('shows clean model basenames without checkpoint extensions', () => {
        expect(formatModelName(undefined)).toBe('');
        expect(formatModelName('D:/models/sdxl/my_model.safetensors')).toBe('my_model');
        expect(formatModelName('another-model.ckpt')).toBe('another-model');
        expect(formatModelName('clip.pt')).toBe('clip');
    });
});
