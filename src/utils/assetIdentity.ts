const ASSET_EXTENSION_RE = /\.(safetensors|ckpt|pt|bin|pth)$/i;
const ASSET_SEPARATOR_RE = /[\s_.-]+/g;

export const getAssetBasename = (value: string): string => {
    const trimmed = value.trim();
    return trimmed.split(/[\\/]/).pop() || trimmed;
};

export const stripAssetExtension = (value: string): string => (
    getAssetBasename(value).replace(ASSET_EXTENSION_RE, '').trim()
);

export const getAssetMatchKey = (value: string | null | undefined): string => {
    if (!value) return '';
    return stripAssetExtension(value).toLowerCase().replace(ASSET_SEPARATOR_RE, '');
};

export const uniqueAssetAliases = (values: Array<string | null | undefined>): string[] => {
    const aliases: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const alias = value?.trim();
        if (!alias) continue;
        const key = alias.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        aliases.push(alias);
    }

    return aliases;
};
