import type { StartupPhase } from '../bindings';
import { measureStartupPhase } from './startupDiagnostics';

// Only fixed, known query labels reach persistent startup diagnostics.
const startupQueryPhases: ReadonlyMap<string, StartupPhase> = new Map([
    ['searchImages', 'gallery-rows'],
    ['countImages', 'gallery-count'],
    ['countGlobalImages', 'gallery-global-count'],
    ['libraryStats.mediaStats', 'statistics-media'],
    ['libraryStats.avgSteps', 'statistics-steps'],
    ['libraryStats.modelStats', 'statistics-models'],
    ['facets.scoped.checkpoints', 'facet-counts'],
    ['facets.scoped.loras', 'facet-counts'],
    ['facets.scoped.embeddings', 'facet-counts'],
    ['facets.scoped.hypernetworks', 'facet-counts'],
    ['facets.scoped.control_nets', 'facet-counts'],
    ['facets.scoped.ip_adapters', 'facet-counts'],
    ['facets.scoped.tools', 'facet-counts'],
]);

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
        const phase = startupQueryPhases.get(label);
        return await (phase ? measureStartupPhase(phase, fn) : fn());
    } finally {
        console.info(`[DB] ${label} (${reason}) completed in ${summarizeDuration(startedAt)}ms`);
    }
};
