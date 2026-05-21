
/**
 * Configuration for the Prompt Keyword Word Cloud analysis.
 */
export const WORD_CLOUD_CONFIG = {
    /**
     * Keywords to exclude from the word cloud.
     * These are common English words or metadata-specific terms that don't add value.
     */
    STOP_WORDS: [
        // Articles & Conjunctions
        'a', 'an', 'the', 'and', 'or', 'but', 'for', 'nor', 'so', 'yet',
        // Prepositions
        'of', 'in', 'on', 'at', 'with', 'by', 'from', 'to', 'into', 'about', 'through', 'under',
        // Pronouns & Demonstratives
        'this', 'that', 'these', 'those', 'which', 'who', 'whom', 'whose',
        // Verbs (common/auxiliary)
        'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
        // Adverbs & Others
        'very', 'too', 'also', 'just', 'more', 'most', 'some', 'any', 'each', 'few', 'only', 'own', 'same', 'than', 'so', 'then', 'now', 'there', 'here',
        // Image Processing Specific (Low Signal)
        'style', 'view', 'highly', 'detailed', 'render', '4k', '8k', 'resolution', 'quality', 'masterpiece', 'best', 'score', 'rating', 'source', 'image', 'picture', 'v10', 'v20', 'v30',
        // Prompt specific noise
        'says', 'should', 'from', 'with', 'often'
    ]
};
