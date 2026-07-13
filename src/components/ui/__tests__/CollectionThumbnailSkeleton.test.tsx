import { describe, expect, it } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { CollectionThumbnailSkeleton } from '../CollectionThumbnailSkeleton';

describe('CollectionThumbnailSkeleton', () => {
    it('uses an empty class suffix by default', () => {
        render(<CollectionThumbnailSkeleton />);
        expect(screen.getByTestId('collection-thumbnail-skeleton').className.endsWith(' ')).toBe(true);
    });
});
