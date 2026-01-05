/**
 * Formats a number into a shorter, human-readable string.
 * Examples:
 * 850 -> "850"
 * 1200 -> "1.2k"
 * 22400 -> "22.4k"
 * 1200000 -> "1.2M"
 */
export const formatCount = (count: number): string => {
    if (count < 1000) {
        return count.toString();
    }

    if (count < 1000000) {
        const kValue = count / 1000;
        return kValue >= 10
            ? `${kValue.toFixed(1)}k`
            : `${kValue.toFixed(1)}k`; // Could be more specific if 1.0k vs 1k is desired
    }

    const mValue = count / 1000000;
    return `${mValue.toFixed(1)}M`;
};

/**
 * Optimized version that avoids .0 if not needed
 */
export const formatCountCompact = (count: number): string => {
    if (count < 1000) return count.toString();

    const format = (num: number, suffix: string) => {
        const fixed = num.toFixed(1);
        return fixed.endsWith('.0') ? `${Math.floor(num)}${suffix}` : `${fixed}${suffix}`;
    };

    if (count < 1000000) {
        return format(count / 1000, 'k');
    }

    return format(count / 1000000, 'M');
};
