import { describe, expect, it } from 'vitest';
import { GeneratorTool, type ImageMetadata } from '../../../../types';
import { getModelPresentation } from './modelPresentation';

const metadata = (overrides: Partial<ImageMetadata> = {}): ImageMetadata => ({
    tool: GeneratorTool.UNKNOWN,
    model: 'Unknown',
    steps: 0,
    cfg: 0,
    sampler: 'Unknown',
    positivePrompt: '',
    negativePrompt: '',
    ...overrides,
});

describe('getModelPresentation', () => {
    it('keeps user overrides ahead of extracted names and hashes', () => {
        expect(getModelPresentation(metadata({
            overrideModel: 'User model',
            model: 'Resolved model',
            modelHash: 'abc123',
        }))).toEqual({ value: 'User model', isHashFallback: false, isOverride: true });
    });

    it('shows a resolved or parsed name ahead of its supporting hash', () => {
        expect(getModelPresentation(metadata({ model: 'Resolved model', modelHash: 'abc123' }))).toEqual({
            value: 'Resolved model',
            isHashFallback: false,
            isOverride: false,
        });
    });

    it('uses a stored hash only when no human-readable name is known', () => {
        expect(getModelPresentation(metadata({ modelHash: 'f8bb2922e1' }))).toEqual({
            value: 'f8bb2922e1',
            isHashFallback: true,
            isOverride: false,
        });
    });

    it('falls back to Unknown when neither a name nor hash is available', () => {
        expect(getModelPresentation(metadata())).toEqual({
            value: 'Unknown',
            isHashFallback: false,
            isOverride: false,
        });
    });
});
