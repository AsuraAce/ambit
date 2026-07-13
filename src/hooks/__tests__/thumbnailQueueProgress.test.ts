import { describe, expect, it } from 'vitest';
import {
    formatThumbnailQueueCompleteMessage,
    formatThumbnailQueueRunningMessage
} from '../thumbnailQueueProgress';

describe('thumbnail queue progress copy', () => {
    it('shows the start message before the first file is checked', () => {
        expect(formatThumbnailQueueRunningMessage({ checked: 0, optimized: 0, failed: 0 }))
            .toBe('Checking library thumbnails...');
    });

    it('uses singular units and a successful completion summary', () => {
        expect(formatThumbnailQueueRunningMessage({ checked: 1, optimized: 1, failed: 0 }))
            .toBe('Optimized 1 thumbnail');
        expect(formatThumbnailQueueCompleteMessage({ checked: 1, optimized: 1, failed: 0 }))
            .toBe('Finished: 1 thumbnail optimized');
    });

    it('focuses on optimized thumbnails when checked and optimized counts match', () => {
        expect(formatThumbnailQueueRunningMessage({
            checked: 340,
            optimized: 340,
            failed: 0
        })).toBe('Optimized 340 thumbnails');
    });

    it('keeps checked count secondary when not every checked image was optimized', () => {
        expect(formatThumbnailQueueRunningMessage({
            checked: 340,
            optimized: 338,
            failed: 0
        })).toBe('Optimized 338 thumbnails after checking 340 images');
    });

    it('uses a distinct complete message when no updates were needed', () => {
        expect(formatThumbnailQueueCompleteMessage({
            checked: 340,
            optimized: 0,
            failed: 0
        })).toBe('Finished: no thumbnail updates needed');
    });

    it('uses attention copy for failures', () => {
        expect(formatThumbnailQueueRunningMessage({
            checked: 340,
            optimized: 338,
            failed: 2
        })).toBe('Optimized 338 thumbnails; 2 need attention');
    });

    it('uses singular attention copy in the completion summary', () => {
        expect(formatThumbnailQueueCompleteMessage({
            checked: 5,
            optimized: 4,
            failed: 1
        })).toBe('Finished: 4 thumbnails optimized; 1 needs attention');
    });
});
