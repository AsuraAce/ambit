import { describe, expect, it } from 'vitest';
import {
    formatInvokeImageCategory,
    getInvokeImageAssetLabel,
    isKnownInvokeImageAsset,
} from '../invokeImageSource';

describe('InvokeAI image source classification', () => {
    it.each([
        ['user', 'User'],
        ['control', 'Control'],
        ['mask', 'Mask'],
        ['other', 'Other'],
        [' CONTROL ', 'Control'],
    ])('classifies known asset category %s', (category, label) => {
        expect(isKnownInvokeImageAsset(category)).toBe(true);
        expect(getInvokeImageAssetLabel(category)).toBe(label);
    });

    it.each(['general', 'future-category', '', '   ', undefined, null])(
        'keeps output or unknown category %s outside the asset set',
        category => {
            expect(isKnownInvokeImageAsset(category)).toBe(false);
            expect(getInvokeImageAssetLabel(category)).toBeUndefined();
        }
    );

    it('formats known categories while preserving unknown source values', () => {
        expect(formatInvokeImageCategory(' GENERAL ')).toBe('General');
        expect(formatInvokeImageCategory('future-Category')).toBe('future-Category');
        expect(formatInvokeImageCategory(' ')).toBeUndefined();
    });
});
