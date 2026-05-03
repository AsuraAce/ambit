const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const summarizeDuration = (startedAt: number) => Math.round(nowMs() - startedAt);

export const describeDbQueryReason = (
    whereClause: string | undefined,
    collectionId?: string,
    loraName?: string
): string => {
    const where = whereClause || '';
    const reasons: string[] = [];

    if (collectionId) reasons.push('collection');
    if (loraName) reasons.push('lora');
    if (where.includes('positive_prompt LIKE')) reasons.push('prompt-like');
    if (where.includes('negative_prompt LIKE')) reasons.push('negative-prompt-like');
    if (where.includes('timestamp >=') || where.includes('timestamp <')) reasons.push('date');
    if (where.includes('privacy_hidden = 0')) reasons.push('privacy');
    if (where.includes('EXISTS (SELECT 1 FROM image_')) reasons.push('resource-exists');

    return reasons.length > 0 ? reasons.join('+') : 'default';
};

export const timeDbCall = async <T>(
    label: string,
    reason: string,
    fn: () => Promise<T>
): Promise<T> => {
    const startedAt = nowMs();

    try {
        return await fn();
    } finally {
        console.info(`[DB] ${label} (${reason}) completed in ${summarizeDuration(startedAt)}ms`);
    }
};
