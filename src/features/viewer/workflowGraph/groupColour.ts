export type Palette = 'quiet' | 'familiar';

/** The only group colour a file may set: plain hex. The backend checks this too; the view checks again. */
const PLAIN_HEX = /^#[0-9a-fA-F]{3,8}$/;

/** ComfyUI's group colour presets, by their saved hex, and the Quiet token each maps to. */
const PRESET_TOKENS: Record<string, string> = {
    '#a88': '--group-red',
    '#b06634': '--group-brown',
    '#8a8': '--group-green',
    '#88a': '--group-blue',
    '#3f789e': '--group-pale-blue',
    '#8aa': '--group-cyan',
    '#a1309b': '--group-purple',
    '#b58b2a': '--group-yellow',
    '#444': '--group-black',
};

const NEUTRAL = 'var(--group-neutral)';

const shortHex = (hex: string): string => {
    const lower = hex.toLowerCase();
    // #aa8888 is the same preset as #a88.
    if (lower.length === 7 && lower[1] === lower[2] && lower[3] === lower[4] && lower[5] === lower[6]) {
        return `#${lower[1]}${lower[3]}${lower[5]}`;
    }
    return lower;
};

/**
 * The CSS colour for a group. Quiet maps presets to tokens and anything else to neutral. Familiar shows the
 * file's own colour: it is user content, the design-system "Exceptions" section, and is only ever plain hex.
 */
export const groupColour = (color: string | null, palette: Palette): string => {
    if (!color || !PLAIN_HEX.test(color)) return NEUTRAL;
    if (palette === 'familiar') return color;
    const token = PRESET_TOKENS[shortHex(color)];
    return token ? `var(${token})` : NEUTRAL;
};
