export interface ThumbnailQueueProgressCounts {
    checked: number;
    optimized: number;
    missing?: number;
    skipped?: number;
    failed: number;
}

export const THUMBNAIL_QUEUE_START_MESSAGE = 'Checking library thumbnails...';
export const THUMBNAIL_QUEUE_RUNNING_FOOTER = 'Runs at low priority and throttles while you browse.';
export const THUMBNAIL_QUEUE_COMPLETE_FOOTER = 'Library thumbnails are up to date.';
export const THUMBNAIL_QUEUE_FAILURE_FOOTER = 'Some files may be corrupt or unavailable.';

const formatUnit = (count: number, unit: string) => (
    `${count.toLocaleString()} ${unit}${count === 1 ? '' : 's'}`
);

const formatAttention = (count: number) => (
    count === 1 ? '1 needs attention' : `${count.toLocaleString()} need attention`
);

const formatMissing = (count: number) => (
    `marked ${formatUnit(count, 'file')} missing`
);

const formatDeferred = (count: number) => (
    `deferred ${formatUnit(count, 'file')} from unavailable folders`
);

export const formatThumbnailQueueRunningMessage = ({
    checked,
    optimized,
    missing = 0,
    skipped = 0,
    failed
}: ThumbnailQueueProgressCounts): string => {
    if (checked <= 0) {
        return THUMBNAIL_QUEUE_START_MESSAGE;
    }

    const optimizedText = formatUnit(optimized, 'thumbnail');

    if (failed > 0) {
        const missingText = missing > 0 ? `; ${formatMissing(missing)}` : '';
        const deferredText = skipped > 0 ? `; ${formatDeferred(skipped)}` : '';
        return `Optimized ${formatUnit(optimized, 'thumbnail')}${missingText}${deferredText}; ${formatAttention(failed)}`;
    }

    if (missing > 0) {
        const deferredText = skipped > 0 ? `; ${formatDeferred(skipped)}` : '';
        return `Optimized ${formatUnit(optimized, 'thumbnail')}; ${formatMissing(missing)}${deferredText}`;
    }

    if (skipped > 0) {
        if (optimized === 0) {
            return `Checked ${formatUnit(checked, 'image')}; ${formatDeferred(skipped)}`;
        }
        return `Optimized ${formatUnit(optimized, 'thumbnail')}; ${formatDeferred(skipped)}`;
    }

    if (checked !== optimized) {
        return `Optimized ${formatUnit(optimized, 'thumbnail')} after checking ${formatUnit(checked, 'image')}`;
    }

    return `Optimized ${optimizedText}`;
};

export const formatThumbnailQueueCompleteMessage = ({
    optimized,
    missing = 0,
    skipped = 0,
    failed
}: ThumbnailQueueProgressCounts): string => {
    if (failed > 0) {
        const missingText = missing > 0 ? `; ${formatMissing(missing)}` : '';
        const deferredText = skipped > 0 ? `; ${formatDeferred(skipped)}` : '';
        return `Finished: ${formatUnit(optimized, 'thumbnail')} optimized${missingText}${deferredText}; ${formatAttention(failed)}`;
    }

    if (optimized === 0 && missing > 0) {
        const deferredText = skipped > 0 ? `; ${formatDeferred(skipped)}` : '';
        return `Finished: ${formatMissing(missing)}${deferredText}`;
    }

    if (missing > 0) {
        const deferredText = skipped > 0 ? `; ${formatDeferred(skipped)}` : '';
        return `Finished: ${formatUnit(optimized, 'thumbnail')} optimized; ${formatMissing(missing)}${deferredText}`;
    }

    if (skipped > 0) {
        return `Finished: ${formatDeferred(skipped)}`;
    }

    if (optimized === 0) {
        return 'Finished: no thumbnail updates needed';
    }

    return `Finished: ${formatUnit(optimized, 'thumbnail')} optimized`;
};
