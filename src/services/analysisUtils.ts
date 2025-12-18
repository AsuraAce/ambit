
/**
 * Calculates the Levenshtein distance between two strings.
 * Used for comparing prompts to detect variations/upscales.
 */
export const calculateLevenshteinDistance = (a: string, b: string): number => {
    const matrix = [];
    let i, j;

    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    for (i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (i = 1; i <= b.length; i++) {
        for (j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }

    return matrix[b.length][a.length];
};

/**
 * Returns a similarity score between 0 and 1.
 * 1.0 = identical, 0.0 = completely different.
 */
export const calculateSimilarity = (str1: string, str2: string): number => {
    const longer = str1.length > str2.length ? str1 : str2;
    if (longer.length === 0) return 1.0;
    
    const distance = calculateLevenshteinDistance(str1, str2);
    return (longer.length - distance) / longer.length;
};
