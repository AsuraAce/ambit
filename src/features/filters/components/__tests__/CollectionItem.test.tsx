import * as React from 'react';
import { render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import type { Collection, FilterState } from '../../../../types';
import { CollectionItem } from '../CollectionItem';
import { createDefaultFilters } from '../../../../utils/filterState';

vi.mock('../../../../components/ui/PrivacyAwareThumbnail', () => ({
    PrivacyAwareThumbnail: ({ src }: { src?: string | null }) => (
        <div data-testid="privacy-aware-thumbnail" data-src={src || ''} />
    )
}));

const filters: FilterState = {
    searchQuery: '',
    models: [],
    tools: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    samplers: [],
    generationTypes: [],
    controlNets: [],
    ipAdapters: [],
    dateRange: 'all',
    favoritesOnly: false,
    collectionId: null
};

const baseCollection: Collection = {
    id: 'collection-1',
    name: 'Collection One',
    imageIds: [],
    count: 1,
    createdAt: 1,
    updatedAt: 1,
    source: 'ambit'
};

const smartCollection: Collection = {
    ...baseCollection,
    id: 'smart-collection-1',
    name: 'Smart Collection One',
    filters: createDefaultFilters({ dateRange: 'today' })
};

const noopDrag = (_event: React.DragEvent, _collectionId: string) => { };
const noopDrop = (_event: React.DragEvent, _collectionId: string) => { };
const noopContextMenu = (_event: React.MouseEvent, _collectionId: string) => { };

const renderCollectionItem = (
    collection: Collection,
    options: {
        isThumbnailPending?: boolean;
        viewMode?: 'grid' | 'list';
    } = {}
) => render(
    <CollectionItem
        col={collection}
        filters={filters}
        setFilters={() => { }}
        editingColId={null}
        editName=""
        setEditName={() => { }}
        setEditingColId={() => { }}
        handleRenameSubmit={() => { }}
        handleDragEnter={noopDrag}
        handleDragOver={noopDrag}
        handleDragLeave={() => { }}
        handleDrop={noopDrop}
        handleContextMenu={noopContextMenu}
        dropTargetId={null}
        viewMode={options.viewMode ?? 'list'}
        isThumbnailPending={options.isThumbnailPending}
    />
);

describe('CollectionItem thumbnail hydration states', () => {
    it('renders a skeleton while a collection thumbnail is pending', () => {
        renderCollectionItem(baseCollection, { isThumbnailPending: true });

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders the fallback once a collection has no thumbnail pending', () => {
        renderCollectionItem({
            ...baseCollection,
            count: 0
        });

        expect(screen.getByTestId('collection-thumbnail-fallback')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders an existing thumbnail instead of the pending skeleton', () => {
        renderCollectionItem({
            ...baseCollection,
            thumbnail: 'asset://collection-thumb.webp'
        }, { isThumbnailPending: true });

        expect(screen.getByTestId('privacy-aware-thumbnail').getAttribute('data-src')).toBe('asset://collection-thumb.webp');
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
    });

    it('renders the pending skeleton in grid mode', () => {
        renderCollectionItem(baseCollection, {
            isThumbnailPending: true,
            viewMode: 'grid'
        });

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
    });

    it('renders a skeleton while a smart collection thumbnail is pending', () => {
        renderCollectionItem(smartCollection, { isThumbnailPending: true });

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders a cached smart collection thumbnail instead of the pending skeleton', () => {
        renderCollectionItem({
            ...smartCollection,
            thumbnail: 'asset://cached-smart-thumb.webp',
            thumbnailSourceKind: 'dynamic'
        }, { isThumbnailPending: true });

        expect(screen.getByTestId('privacy-aware-thumbnail').getAttribute('data-src')).toBe('asset://cached-smart-thumb.webp');
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
    });

    it('renders the smart collection fallback after pending clears with no thumbnail', () => {
        renderCollectionItem(smartCollection);

        expect(screen.getByTestId('collection-thumbnail-fallback')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });
});
