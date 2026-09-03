import type { ImageMetadata } from '../../../../types';

export interface ModelPresentation {
    value: string;
    isHashFallback: boolean;
    isOverride: boolean;
}

const cleanValue = (value?: string): string | undefined => {
    const cleaned = value?.trim();
    return cleaned ? cleaned : undefined;
};

const isUnknownModel = (value?: string): boolean => {
    const normalized = value?.trim().toLocaleLowerCase();
    return !normalized || normalized === 'unknown' || normalized === 'unknown model';
};

export const getModelPresentation = (metadata: ImageMetadata): ModelPresentation => {
    const override = cleanValue(metadata.overrideModel);
    if (override) return { value: override, isHashFallback: false, isOverride: true };

    if (!isUnknownModel(metadata.model)) {
        return { value: metadata.model.trim(), isHashFallback: false, isOverride: false };
    }

    const hash = cleanValue(metadata.modelHash);
    if (hash) return { value: hash, isHashFallback: true, isOverride: false };

    return { value: 'Unknown', isHashFallback: false, isOverride: false };
};
