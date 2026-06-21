const ASSET_EXTENSION_RE = /\.(safetensors|ckpt|pt|bin|pth)$/i;
const ASSET_SEPARATOR_RE = /[\s_.,-]+/g;
const LABEL_SUFFIX_SEPARATOR_RE = /\s+-\s+|,\s*/g;

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

export const getAssetMatchKeyCandidates = (value: string | null | undefined): string[] => {
    if (!value) return [];

    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (candidate: string) => {
        const key = getAssetMatchKey(candidate);
        if (!key || seen.has(key)) return;
        seen.add(key);
        candidates.push(key);
    };

    const stripped = stripAssetExtension(value);
    addCandidate(stripped);

    for (const match of stripped.matchAll(LABEL_SUFFIX_SEPARATOR_RE)) {
        addCandidate(stripped.slice(match.index + match[0].length));
    }

    return candidates;
};

export const resolveAssetMatchKey = (
    value: string | null | undefined,
    knownMatchKeys?: ReadonlySet<string>
): string => {
    const [primary = '', ...candidates] = getAssetMatchKeyCandidates(value);
    if (!knownMatchKeys || knownMatchKeys.size === 0) return primary;
    if (knownMatchKeys.has(primary)) return primary;
    return candidates.find(candidate => knownMatchKeys.has(candidate)) ?? primary;
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
