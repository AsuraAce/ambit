import type { AIImage } from '../types';

/** The image fields an optimistic write changes on screen before the database confirms it. */
export type ImageWriteField = 'isFavorite' | 'isPinned' | 'userMasked' | 'notes';

export interface ImageFieldChange<F extends ImageWriteField> {
    id: string;
    previous: AIImage[F];
    next: AIImage[F];
}

export interface ImageFieldWrite<F extends ImageWriteField> {
    /**
     * Records how the write ended; call it once, on success and on failure. Returns, for each failed
     * image whose field no later write has taken over, the value to show again: the latest earlier
     * write to that field that did not fail, or the value before the first of them.
     */
    settle: (failedIds?: Iterable<string>) => Map<string, Pick<AIImage, F>>;
}

interface PendingValue {
    value: AIImage[ImageWriteField];
    status: 'pending' | 'succeeded' | 'failed';
}

// Every unsettled write per image field, in the order they were issued; the database applies
// them in that order, so the latest one that does not fail is what it ends up holding.
const chains = new Map<string, { base: AIImage[ImageWriteField]; writes: PendingValue[] }>();
const chainKey = (field: ImageWriteField, id: string) => `${field}:${id}`;

export const beginImageFieldWrite = <F extends ImageWriteField>(field: F, changes: readonly ImageFieldChange<F>[]): ImageFieldWrite<F> => {
    const entries = new Map<string, PendingValue>();
    for (const { id, previous, next } of changes) {
        const key = chainKey(field, id);
        const chain = chains.get(key) ?? { base: previous, writes: [] };
        const entry: PendingValue = { value: next, status: 'pending' };
        chain.writes.push(entry);
        chains.set(key, chain);
        entries.set(id, entry);
    }

    let settled = false;
    return {
        settle: (failedIds = []) => {
            const reverts = new Map<string, Pick<AIImage, F>>();
            if (settled) return reverts;
            settled = true;

            const failed = new Set(failedIds);
            entries.forEach((entry, id) => {
                const key = chainKey(field, id);
                const chain = chains.get(key);
                if (!chain) return;
                entry.status = failed.has(id) ? 'failed' : 'succeeded';

                const index = chain.writes.indexOf(entry);
                const superseded = chain.writes.slice(index + 1).some((write) => write.status !== 'failed');
                if (entry.status === 'failed' && !superseded) {
                    const earlier = chain.writes
                        .slice(0, index)
                        .reverse()
                        .find((write) => write.status !== 'failed');
                    reverts.set(id, { [field]: earlier ? earlier.value : chain.base } as Pick<AIImage, F>);
                }
                if (chain.writes.every((write) => write.status !== 'pending')) chains.delete(key);
            });
            return reverts;
        },
    };
};

/** For tests only: the number of image fields with an unsettled write. */
export const countPendingImageFieldWritesForTests = (): number => chains.size;

/** For tests only: forgets every unsettled write, so one test's pending writes cannot reach the next. */
export const resetImageFieldWritesForTests = (): void => chains.clear();
