const INVOKE_IMAGE_ASSET_LABELS = new Map<string, string>([
    ['user', 'User'],
    ['control', 'Control'],
    ['mask', 'Mask'],
    ['other', 'Other'],
]);

const INVOKE_IMAGE_CATEGORY_LABELS = new Map<string, string>([
    ['general', 'General'],
    ...INVOKE_IMAGE_ASSET_LABELS,
]);

const normalizeInvokeImageCategory = (category: string | null | undefined): string | undefined => {
    const normalized = category?.trim().toLowerCase();
    return normalized || undefined;
};

export const getInvokeImageAssetLabel = (category: string | null | undefined): string | undefined => {
    const normalized = normalizeInvokeImageCategory(category);
    return normalized ? INVOKE_IMAGE_ASSET_LABELS.get(normalized) : undefined;
};

export const isKnownInvokeImageAsset = (category: string | null | undefined): boolean =>
    getInvokeImageAssetLabel(category) !== undefined;

export const formatInvokeImageCategory = (category: string | null | undefined): string | undefined => {
    const value = category?.trim();
    if (!value) return undefined;

    return INVOKE_IMAGE_CATEGORY_LABELS.get(value.toLowerCase()) ?? value;
};
